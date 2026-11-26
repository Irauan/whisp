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
//                   { type: 'message', message }                an ACP message from the client
//                   { type: 'gate', name, state }               'waiting' or 'passed'
//                   { type: 'exit', code }                      the agent ends on a scenario step
//                   { type: 'ack', id, error? }                 a command took effect
//   test -> agent   { type: 'start', scenario, opened }         answer to hello. The agent
//                                                               handles no ACP request before it.
//                   { type: 'scenario', id, name, options }     choose the scenario
//                   { type: 'open', id, gate }                  open a gate. It stays open.
import net from 'node:net'
import { Readable, Writable } from 'node:stream'
import { agent, methods, ndJsonStream, PROTOCOL_VERSION, RequestError } from '@agentclientprotocol/sdk'
import { resolveScenario } from './scenarios.mjs'

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
socket.on('connect', () => void report({ type: 'hello', pid: process.pid }))

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
    if (!client && (step.do === 'say' || step.do === 'tool')) throw new Error(`Step "${step.do}" needs a session.`)
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
      case 'fail':
        throw new RequestError(step.code, step.message)
      case 'exit':
        await report({ type: 'exit', code: step.code })
        process.exit(step.code)
        break
      default:
        throw new Error(`Unknown step "${step.do}".`)
    }
  }
  return 'end_turn'
}

// The ACP side.

let nextSession = 0
/** The running turn of each session. A cancel notification aborts it. */
const turns = new Map()

const app = agent({ name: 'simulated-agent' })
  .onRequest(methods.agent.initialize, async () => {
    await ready
    await runSteps(scenario.initialize, { signal: new AbortController().signal })
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { sessionCapabilities: { resume: {} } },
      authMethods: []
    }
  })
  .onRequest(methods.agent.session.new, async () => {
    await ready
    return { sessionId: `s${++nextSession}` }
  })
  .onRequest(methods.agent.session.resume, async ({ params }) => {
    await ready
    if (!params.sessionId.startsWith('s')) throw RequestError.invalidParams(undefined, 'Unknown session')
    return {}
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
void connection.closed.then(() => process.exit(0))
