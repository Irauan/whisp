// The simulated agent: a separate ACP program for tests. It speaks real ACP on stdin and stdout.
//
// Start it with one argument, the name of the control pipe that the test listens on:
//
//   node agent.mjs \\.\pipe\aether-simulated-agent-1234
//
// On the control pipe the test chooses the scenario and opens gates. The agent reports each ACP
// message it receives. The agent uses no timers: it waits on gates and on messages only.
//
// The control protocol is one JSON object per line, in both directions.
//
//   agent -> test   { type: 'hello', pid }                      the agent connected
//                   { type: 'environment', pid, cwd, env, args }
//                                                               right after hello: the folder,
//                                                               the environment and the arguments
//                                                               after the script (the pipe name
//                                                               first) that the process got at
//                                                               its start
//                   { type: 'message', message }                an ACP message from the client
//                   { type: 'gate', name, state }               'waiting' or 'passed'
//                   { type: 'exit', code }                      the agent ends on a scenario step
//                   { type: 'child', pid, parent }              a step started a child process that
//                                                               outlives the agent (step 'child')
//                   { type: 'permission', id, outcome | error } the client answered the permission
//                                                               request of the tool call `id`
//                   { type: 'elicitation', id, response | error }
//                                                               the client answered the elicitation
//                                                               `id` (see `requests.mjs`)
//                   { type: 'ack', id, error? }                 a command took effect
//   test -> agent   { type: 'start', scenario, opened }         answer to hello. The agent
//                                                               handles no ACP request before it.
//                   { type: 'scenario', id, name, options }     choose the scenario
//                   { type: 'open', id, gate }                  open a gate. It stays open.
import { spawn } from 'node:child_process'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { Readable, Writable } from 'node:stream'
import { agent, methods, ndJsonStream, PROTOCOL_VERSION, RequestError } from '@agentclientprotocol/sdk'
import { resolveScenario } from './scenarios.mjs'
import { REQUEST_STEPS, runRequestStep } from './requests.mjs'

const pipeName = process.argv[2]
if (!pipeName) {
  console.error('The simulated agent needs the name of the control pipe as its first argument.')
  process.exit(2)
}

// The control channel.

const socket = net.connect(pipeName)
socket.setEncoding('utf8')
socket.on('error', (error) => {
  console.error(`Control pipe failed: ${error.message}`)
  process.exit(1)
})
// The test closes the control server when it is done. The agent ends with it.
socket.on('close', () => process.exit(0))

/** Sends one report. The promise resolves when the pipe took it. */
const report = (event) => new Promise((resolve) => socket.write(`${JSON.stringify(event)}\n`, () => resolve()))

let scenario = resolveScenario('text')
let markReady
const ready = new Promise((resolve) => {
  markReady = resolve
})

const gates = new Map()
function gate(name) {
  let entry = gates.get(name)
  if (!entry) {
    entry = { opened: false, open: undefined, promise: undefined }
    entry.promise = new Promise((resolve) => {
      entry.open = () => {
        entry.opened = true
        resolve()
      }
    })
    gates.set(name, entry)
  }
  return entry
}

function command(message) {
  try {
    switch (message.type) {
      case 'start':
        scenario = resolveScenario(message.scenario.name, message.scenario.options)
        for (const name of message.opened) gate(name).open()
        markReady()
        return
      case 'scenario':
        scenario = resolveScenario(message.name, message.options)
        break
      case 'open':
        gate(message.gate).open()
        break
      default:
        throw new Error(`Unknown command "${message.type}".`)
    }
    void report({ type: 'ack', id: message.id })
  } catch (error) {
    if (message.type === 'start') {
      console.error(error.message)
      process.exit(1)
    }
    void report({ type: 'ack', id: message.id, error: error.message })
  }
}

let pending = ''
socket.on('data', (text) => {
  pending += text
  for (let end = pending.indexOf('\n'); end >= 0; end = pending.indexOf('\n')) {
    const line = pending.slice(0, end)
    pending = pending.slice(end + 1)
    if (line) command(JSON.parse(line))
  }
})
socket.on('connect', () => {
  // The environment report: what the client gave this process at its start. It goes in the same
  // write as the hello, so a test that closes the pipe after the hello cannot break it. `args` are
  // the arguments after the script: the pipe name, then any argument that the client added.
  const start = { type: 'environment', pid: process.pid, cwd: process.cwd(), env: { ...process.env }, args: process.argv.slice(2) }
  socket.write(`${JSON.stringify({ type: 'hello', pid: process.pid })}\n${JSON.stringify(start)}\n`)
})

// The steps of a scenario.

/** Waits at a gate. Returns 'cancelled' when the client cancels the turn first. */
async function waitAtGate(name, signal) {
  // Listen before the first await. A cancel that came earlier, or that comes while the report
  // is on its way, would fire its event with no listener, and the wait would never end.
  const cancelled = signal.aborted
    ? Promise.resolve('cancelled')
    : new Promise((resolve) => signal.addEventListener('abort', () => resolve('cancelled'), { once: true }))
  await report({ type: 'gate', name, state: 'waiting' })
  const entry = gate(name)
  const outcome = await Promise.race([entry.promise.then(() => 'passed'), cancelled])
  if (outcome === 'passed') await report({ type: 'gate', name, state: 'passed' })
  return outcome
}

/** Runs the steps in order. Returns 'cancelled' or 'end_turn'. */
async function runSteps(steps, { signal, sessionId, client }) {
  const update = (value) => client.notify(methods.client.session.update, { sessionId, update: value })
  const say = (text) => update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } })
  for (const step of steps) {
    if (!client && (step.do === 'say' || step.do === 'tool' || step.do === 'update')) {
      throw new Error(`Step "${step.do}" needs a session.`)
    }
    switch (step.do) {
      case 'gate':
        if ((await waitAtGate(step.name, signal)) === 'cancelled') return 'cancelled'
        break
      case 'say':
        await say(step.text)
        break
      case 'tool': {
        await update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: step.title, kind: step.kind, status: 'pending' })
        const answer = await client.request(methods.client.session.requestPermission, {
          sessionId,
          toolCall: { toolCallId: 't1' },
          options: [
            { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
            { optionId: 'no', name: 'Refuse', kind: 'reject_once' }
          ]
        })
        const allowed = answer.outcome.outcome === 'selected' && answer.outcome.optionId === 'yes'
        await update({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: allowed ? 'completed' : 'failed' })
        await say(allowed ? step.allowed : step.refused)
        break
      }
      case 'update':
        await update(step.update)
        break
      case 'log':
        await new Promise((resolve) => process.stderr.write(`${step.text}\n`, () => resolve()))
        break
      case 'fail':
        throw new RequestError(step.code, step.message)
      case 'exit':
        await report({ type: 'exit', code: step.code })
        process.exit(step.code)
        break
      case 'child':
        await startChild()
        break
      default: {
        // The permission requests and the elicitations (story S5 of m1-chat): see `requests.mjs`.
        if (!REQUEST_STEPS.has(step.do)) throw new Error(`Unknown step "${step.do}".`)
        const outcome = await runRequestStep(step, {
          signal,
          sessionId,
          client,
          report,
          update,
          runSteps,
          setMode: (mode) => {
            settingsOf(sessionId).mode = mode
          },
          setModel: (model) => {
            settingsOf(sessionId).model = model
            return stateOf(sessionId).configOptions
          }
        })
        if (outcome === 'cancelled') return 'cancelled'
      }
    }
  }
  return 'end_turn'
}

/**
 * Starts a child process that outlives the agent (`child.mjs`), as a background command of Claude
 * can. It is detached, so it does not end when the agent ends: only a kill ends it. It takes the
 * pipe name as its argument, so its command line names the pipe of the test. Reports its process
 * ID and the process ID of the agent, its parent.
 */
async function startChild() {
  const script = fileURLToPath(new URL('./child.mjs', import.meta.url))
  const child = spawn(process.execPath, [script, pipeName], { detached: true, stdio: 'ignore', windowsHide: true })
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  child.unref()
  await report({ type: 'child', pid: child.pid, parent: process.pid })
}

// The ACP side.

/** The permission modes of Claude Code. The agent accepts these in `session/set_mode`. */
const MODES = [
  { id: 'default', name: 'Default' },
  { id: 'acceptEdits', name: 'Accept edits' },
  { id: 'plan', name: 'Plan' },
  { id: 'auto', name: 'Auto' },
  { id: 'bypassPermissions', name: 'Bypass permissions' }
]

/** The values of the `model` configuration option. The agent accepts these in `session/set_config_option`. */
const MODELS = ['default', 'claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']

/** The mode that Claude Code uses when the model cannot use `auto`. */
const AUTO_FALLBACK = 'acceptEdits'

/**
 * Applies the fallback of Claude Code: when the mode is `auto` and the scenario says that the model
 * cannot use it, the session uses `acceptEdits` and the agent sends a `current_mode_update`. It runs
 * after each change of the mode or the model, so the order of the two requests does not matter.
 */
async function applyAutoFallback(sessionId, client) {
  const current = settingsOf(sessionId)
  if (current.mode !== 'auto' || !(scenario.noAuto ?? []).includes(current.model)) return
  current.mode = AUTO_FALLBACK
  await client.notify(methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: 'current_mode_update', currentModeId: AUTO_FALLBACK }
  })
}

/** The current mode and model of each session. */
const settings = new Map()
function settingsOf(sessionId) {
  if (!settings.has(sessionId)) settings.set(sessionId, { mode: 'default', model: 'default' })
  return settings.get(sessionId)
}

/** The modes and the configuration options of a session, as `session/new` and `session/resume` answer them. */
function stateOf(sessionId) {
  const { mode, model } = settingsOf(sessionId)
  return {
    modes: { currentModeId: mode, availableModes: MODES },
    configOptions: [
      { id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: model, options: MODELS.map((value) => ({ value, name: value })) }
    ]
  }
}

let nextSession = 0
/** The running turn of each session. A cancel notification aborts it. */
const turns = new Map()

const app = agent({ name: 'simulated-agent' })
  .onRequest(methods.agent.initialize, async () => {
    await ready
    await runSteps(scenario.initialize, { signal: new AbortController().signal })
    return {
      protocolVersion: PROTOCOL_VERSION,
      // Claude Code also takes `additionalDirectories` in `session/new` and `session/resume`.
      agentCapabilities: { sessionCapabilities: { resume: {}, additionalDirectories: {} } },
      authMethods: []
    }
  })
  .onRequest(methods.agent.session.new, async () => {
    await ready
    const sessionId = `s${++nextSession}`
    return { sessionId, ...stateOf(sessionId) }
  })
  .onRequest(methods.agent.session.resume, async ({ params }) => {
    await ready
    if (!params.sessionId.startsWith('s')) throw RequestError.invalidParams(undefined, 'Unknown session')
    return stateOf(params.sessionId)
  })
  .onRequest(methods.agent.session.setMode, async ({ params, client }) => {
    await ready
    if (!MODES.some((mode) => mode.id === params.modeId)) {
      throw RequestError.invalidParams(undefined, `Unknown mode "${params.modeId}"`)
    }
    settingsOf(params.sessionId).mode = params.modeId
    await applyAutoFallback(params.sessionId, client)
    return {}
  })
  .onRequest(methods.agent.session.setConfigOption, async ({ params, client }) => {
    await ready
    if (params.configId !== 'model') throw RequestError.invalidParams(undefined, `Unknown option "${params.configId}"`)
    if (!MODELS.includes(params.value)) throw RequestError.invalidParams(undefined, `Unknown model "${params.value}"`)
    settingsOf(params.sessionId).model = params.value
    await applyAutoFallback(params.sessionId, client)
    return { configOptions: stateOf(params.sessionId).configOptions }
  })
  .onNotification(methods.agent.session.cancel, ({ params }) => turns.get(params.sessionId)?.abort())
  .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
    // Register the turn before the first await, so that a cancel after the prompt finds it.
    const turn = new AbortController()
    turns.set(params.sessionId, turn)
    try {
      await ready
      const stopReason = await runSteps(scenario.prompt, { signal: turn.signal, sessionId: params.sessionId, client })
      return { stopReason: stopReason === 'cancelled' ? 'cancelled' : 'end_turn' }
    } finally {
      if (turns.get(params.sessionId) === turn) turns.delete(params.sessionId)
    }
  })

// Report each message that the client sends, before the agent handles it.
const stdio = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin))
const observed = {
  writable: stdio.writable,
  readable: stdio.readable.pipeThrough(
    new TransformStream({
      async transform(message, controller) {
        await report({ type: 'message', message })
        controller.enqueue(message)
      }
    })
  )
}

const connection = app.connect(observed)
// The client closed stdin. A scenario with `exitGate` waits at that gate first, so a test can act
// while the agent ends. Nothing cancels this wait: only the gate or a kill ends it.
void connection.closed.then(async () => {
  if (scenario.exitGate) await waitAtGate(scenario.exitGate, new AbortController().signal)
  process.exit(0)
})
