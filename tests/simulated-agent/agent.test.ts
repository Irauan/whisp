// Tests of the simulated agent itself, with a bare ACP client and no Aether code.
// Each scenario has its test. The tests wait on gates and on reported messages, never on a clock.
import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type ClientConnection,
  type RequestPermissionResponse
} from '@agentclientprotocol/sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ControlServer } from './control'

interface Harness {
  child: ChildProcess
  exited: Promise<number | null>
  /** What the agent wrote to its log (stderr) so far. */
  log(): string
  connection: ClientConnection
  updates: Record<string, unknown>[]
  /** What the client answers to a permission request. */
  answer: RequestPermissionResponse
  permissions: unknown[]
  /** Holds the answer to permission requests until `release` runs. `asked` resolves at the first request. */
  hold(): { asked: Promise<void>; release(): void }
  initialize(): Promise<unknown>
  newSession(): Promise<string>
  prompt(sessionId: string, text?: string): Promise<{ stopReason: string }>
}

let control: ControlServer
let harness: Harness[]

function startAgent(env: NodeJS.ProcessEnv = process.env): Harness {
  const { command, args } = control.agent
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env })
  let log = ''
  child.stderr!.setEncoding('utf8')
  child.stderr!.on('data', (text: string) => {
    log += text
    process.stderr.write(text)
  })
  // The exit code comes with 'close', after the log is complete.
  const exited = new Promise<number | null>((resolve) => child.once('close', resolve))
  const updates: Record<string, unknown>[] = []
  const permissions: unknown[] = []
  const state = {
    answer: { outcome: { outcome: 'selected', optionId: 'yes' } } as RequestPermissionResponse,
    held: undefined as { asked(): void; released: Promise<void> } | undefined
  }
  const app = client({ name: 'test' })
    .onNotification(methods.client.session.update, ({ params }) => {
      updates.push(params.update as Record<string, unknown>)
    })
    .onRequest(methods.client.session.requestPermission, async ({ params }) => {
      permissions.push(params)
      state.held?.asked()
      await state.held?.released
      return state.answer
    })
  const connection = app.connect(
    ndJsonStream(
      Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>
    )
  )
  const made: Harness = {
    child,
    exited,
    log: () => log,
    connection,
    updates,
    permissions,
    get answer() {
      return state.answer
    },
    set answer(value) {
      state.answer = value
    },
    hold: () => {
      let release!: () => void
      let asked!: () => void
      const released = new Promise<void>((resolve) => (release = resolve))
      const wasAsked = new Promise<void>((resolve) => (asked = resolve))
      state.held = { asked, released }
      return { asked: wasAsked, release }
    },
    initialize: () =>
      connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'test', version: '0' },
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }
      }),
    newSession: async () => (await connection.agent.request(methods.agent.session.new, { cwd: process.cwd(), mcpServers: [] })).sessionId,
    prompt: (sessionId, text = 'hello') =>
      connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text }] })
  }
  harness.push(made)
  return made
}

const texts = (updates: Record<string, unknown>[]) =>
  updates
    .filter((update) => update.sessionUpdate === 'agent_message_chunk')
    .map((update) => (update.content as { text: string }).text)

beforeEach(async () => {
  control = await ControlServer.start()
  harness = []
})

afterEach(async () => {
  for (const { child, connection } of harness) {
    connection.close()
    child.kill()
  }
  await control.close()
})

describe('simulated agent', () => {
  it('starts from a pipe name that is unique for each control server', async () => {
    const other = await ControlServer.start()
    expect(other.pipeName).not.toBe(control.pipeName)
    expect(control.pipeName).toMatch(/^\\\\\.\\pipe\\/)
    await other.close()
  })

  it('ends with a clear message when it has no pipe name', async () => {
    const child = spawn(process.execPath, [join(__dirname, 'agent.mjs')], { stdio: 'ignore' })
    expect(await new Promise((resolve) => child.once('exit', resolve))).toBe(2)
  })

  describe('scenario text', () => {
    it('streams its chunks and reports each ACP message', async () => {
      await control.scenario('text')
      const agent = startAgent()
      await agent.initialize()
      const session = await agent.newSession()
      expect(await agent.prompt(session)).toEqual({ stopReason: 'end_turn' })
      expect(texts(agent.updates)).toEqual(['Hel', 'lo'])
      expect(control.messages.map((message) => message.method)).toEqual(['initialize', 'session/new', 'session/prompt'])
      expect(control.received('session/prompt')[0]?.params).toMatchObject({ sessionId: session, prompt: [{ type: 'text', text: 'hello' }] })
    })

    it('takes its chunks from the options', async () => {
      await control.scenario('text', { chunks: ['One', 'Two', 'Three'] })
      const agent = startAgent()
      await agent.initialize()
      await agent.prompt(await agent.newSession())
      expect(texts(agent.updates)).toEqual(['One', 'Two', 'Three'])
    })

    it('waits at a gate, and replies after the test opens it', async () => {
      await control.scenario('text', { gate: 'reply' })
      const agent = startAgent()
      await agent.initialize()
      const session = await agent.newSession()
      const turn = agent.prompt(session)
      await control.waitForGate('reply')
      expect(agent.updates).toEqual([])
      await control.open('reply')
      await turn
      expect(texts(agent.updates)).toEqual(['Hel', 'lo'])
    })

    it('passes a gate that the test opened before the agent got there', async () => {
      await control.scenario('text', { gate: 'reply' })
      await control.open('reply')
      const agent = startAgent()
      await agent.initialize()
      await agent.prompt(await agent.newSession())
      await control.waitForGatePassed('reply')
      expect(texts(agent.updates)).toEqual(['Hel', 'lo'])
    })

    it('ends the turn as cancelled when the client cancels at a gate', async () => {
      await control.scenario('text', { gate: 'never' })
      const agent = startAgent()
      await agent.initialize()
      const session = await agent.newSession()
      const turn = agent.prompt(session)
      await control.waitForGate('never')
      await agent.connection.agent.notify(methods.agent.session.cancel, { sessionId: session })
      expect(await turn).toEqual({ stopReason: 'cancelled' })
      expect(agent.updates).toEqual([])
    })

    it('ends the turn as cancelled when the cancel came before the agent reached a gate', async () => {
      await control.scenario('steps', { prompt: [{ do: 'tool', title: 'Edit', kind: 'edit', allowed: 'Yes', refused: 'No' }, { do: 'gate', name: 'late' }] })
      const agent = startAgent()
      const held = agent.hold()
      await agent.initialize()
      const session = await agent.newSession()
      const turn = agent.prompt(session)
      await held.asked
      // The turn is busy with the tool call, so the cancel arrives before the gate step starts.
      await agent.connection.agent.notify(methods.agent.session.cancel, { sessionId: session })
      held.release()
      expect(await turn).toEqual({ stopReason: 'cancelled' })
    })

    it('resumes a session of its own and refuses an unknown one', async () => {
      const agent = startAgent()
      await agent.initialize()
      await agent.connection.agent.request(methods.agent.session.resume, { sessionId: 's9', cwd: process.cwd(), mcpServers: [] })
      await expect(
        agent.connection.agent.request(methods.agent.session.resume, { sessionId: 'other', cwd: process.cwd(), mcpServers: [] })
      ).rejects.toBeInstanceOf(RequestError)
    })
  })

  describe('scenario tool', () => {
    it('asks permission and tells that the client allowed it', async () => {
      await control.scenario('tool')
      const agent = startAgent()
      await agent.initialize()
      await agent.prompt(await agent.newSession())
      expect(agent.permissions).toMatchObject([{ toolCall: { toolCallId: 't1' }, options: [{ optionId: 'yes' }, { optionId: 'no' }] }])
      expect(agent.updates).toMatchObject([
        { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Edit README.md', status: 'pending' },
        { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' },
        { sessionUpdate: 'agent_message_chunk', content: { text: 'Edited' } }
      ])
      // The agent reports the answer of the client as a message too.
      expect(control.messages.filter((message) => message.result !== undefined && message.method === undefined).at(-1)?.result).toMatchObject({
        outcome: { outcome: 'selected', optionId: 'yes' }
      })
    })

    it('tells that the client refused it', async () => {
      await control.scenario('tool')
      const agent = startAgent()
      agent.answer = { outcome: { outcome: 'cancelled' } }
      await agent.initialize()
      await agent.prompt(await agent.newSession())
      expect(agent.updates).toMatchObject([
        { sessionUpdate: 'tool_call' },
        { sessionUpdate: 'tool_call_update', status: 'failed' },
        { sessionUpdate: 'agent_message_chunk', content: { text: 'Skipped' } }
      ])
    })

    it('waits at a gate before the tool call', async () => {
      await control.scenario('tool', { gate: 'tool' })
      const agent = startAgent()
      await agent.initialize()
      const turn = agent.prompt(await agent.newSession())
      await control.waitForGate('tool')
      expect(agent.permissions).toEqual([])
      await control.open('tool')
      await turn
      expect(agent.permissions).toHaveLength(1)
    })
  })

  describe('scenario sign-in-error', () => {
    it('answers the prompt with the ACP error for "authentication required"', async () => {
      await control.scenario('sign-in-error')
      const agent = startAgent()
      await agent.initialize()
      const session = await agent.newSession()
      await expect(agent.prompt(session)).rejects.toMatchObject({ code: -32000, message: 'Authentication required' })
    })
  })

  describe('scenario crash', () => {
    it('ends the process with its exit code when it gets a prompt', async () => {
      await control.scenario('crash', { exitCode: 7 })
      const agent = startAgent()
      await agent.initialize()
      const session = await agent.newSession()
      await expect(agent.prompt(session)).rejects.toBeDefined()
      expect(await agent.exited).toBe(7)
      await control.waitForClose()
    })
  })

  describe('scenario slow-start', () => {
    it('holds the answer to initialize until the test opens the gate', async () => {
      await control.scenario('slow-start')
      const agent = startAgent()
      let answered = false
      const starting = agent.initialize().then(() => {
        answered = true
      })
      await control.waitForGate('initialize')
      // The agent reported the gate before it waited, so it cannot have answered yet.
      expect(answered).toBe(false)
      await control.open('initialize')
      await starting
      expect(answered).toBe(true)
      await agent.prompt(await agent.newSession())
      expect(texts(agent.updates)).toEqual(['Hel', 'lo'])
    })
  })

  // Added for story S4 of milestone m1-chat: the start report, the process of each report, the
  // steps "update" and "log", the log line of the crash scenario, and the mode and model requests.
  describe('start report and processes', () => {
    it('reports its process ID, its folder and its environment when it connects', async () => {
      const agent = startAgent({ ...process.env, AETHER_SIMULATED_PROBE: 'probe-value' })
      expect(await control.waitForAgent()).toBe(agent.child.pid)
      const start = await control.waitForEnvironment()
      expect(start.pid).toBe(agent.child.pid)
      expect(start.cwd).toBe(process.cwd())
      expect(start.env.AETHER_SIMULATED_PROBE).toBe('probe-value')
      expect(control.pids).toEqual([agent.child.pid])
      expect(control.environments.map(({ pid }) => pid)).toEqual([agent.child.pid])
    })

    it('tells which process received each message', async () => {
      const first = startAgent()
      const firstPid = await control.waitForAgent()
      const second = startAgent()
      const secondPid = await control.waitForAgent()
      await first.initialize()
      await second.initialize()
      await first.prompt(await first.newSession())
      await second.prompt(await second.newSession())
      await control.waitForMessage('session/prompt')
      await control.waitForMessage('session/prompt')
      expect(firstPid).not.toBe(secondPid)
      expect(control.receivedBy('session/new').map(({ pid }) => pid)).toEqual([firstPid, secondPid])
      expect(control.receivedBy('session/prompt').map(({ pid }) => pid)).toEqual([firstPid, secondPid])
    })

    it('tells which process closed its pipe', async () => {
      await control.scenario('crash', { exitCode: 5 })
      const agent = startAgent()
      const pid = await control.waitForAgent()
      await agent.initialize()
      await expect(agent.prompt(await agent.newSession())).rejects.toBeDefined()
      expect(await control.waitForClose()).toBe(pid)
    })
  })

  describe('steps update and log', () => {
    it('sends the update of a step as it is, with no permission request', async () => {
      const update = { sessionUpdate: 'tool_call', toolCallId: 'run', title: 'Run the tests', kind: 'execute', status: 'in_progress' }
      await control.scenario('steps', { prompt: [{ do: 'update', update }, { do: 'say', text: 'Done' }] })
      const agent = startAgent()
      await agent.initialize()
      expect(await agent.prompt(await agent.newSession())).toEqual({ stopReason: 'end_turn' })
      expect(agent.updates).toMatchObject([update, { sessionUpdate: 'agent_message_chunk', content: { text: 'Done' } }])
      expect(agent.permissions).toEqual([])
    })

    it('writes the line of a log step to stderr', async () => {
      await control.scenario('steps', { prompt: [{ do: 'log', text: 'simulated agent: a log line' }, { do: 'gate', name: 'logged' }] })
      const agent = startAgent()
      await agent.initialize()
      const turn = agent.prompt(await agent.newSession())
      await control.waitForGate('logged')
      await control.open('logged')
      await turn
      agent.child.stdin!.end()
      await agent.exited
      expect(agent.log()).toContain('simulated agent: a log line')
    })

    it('writes the log line of the crash scenario, then ends with its exit code', async () => {
      await control.scenario('crash', { exitCode: 4, log: 'simulated agent: the disk is full' })
      const agent = startAgent()
      await agent.initialize()
      await expect(agent.prompt(await agent.newSession())).rejects.toBeDefined()
      expect(await agent.exited).toBe(4)
      expect(agent.log()).toContain('simulated agent: the disk is full')
    })
  })

  describe('modes and models', () => {
    const CLAUDE_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions']

    it('answers session/new and session/resume with the five Claude modes and the model option', async () => {
      const agent = startAgent()
      await agent.initialize()
      const created = await agent.connection.agent.request(methods.agent.session.new, { cwd: process.cwd(), mcpServers: [] })
      expect(created.modes?.currentModeId).toBe('default')
      expect(created.modes?.availableModes.map(({ id }) => id)).toEqual(CLAUDE_MODES)
      expect(created.configOptions).toMatchObject([{ id: 'model', type: 'select', currentValue: 'default' }])
      const resumed = await agent.connection.agent.request(methods.agent.session.resume, {
        sessionId: created.sessionId,
        cwd: process.cwd(),
        mcpServers: []
      })
      expect(resumed.modes?.currentModeId).toBe('default')
    })

    it('applies each permission mode of Claude and refuses another mode', async () => {
      const agent = startAgent()
      await agent.initialize()
      const sessionId = await agent.newSession()
      for (const modeId of CLAUDE_MODES) {
        await agent.connection.agent.request(methods.agent.session.setMode, { sessionId, modeId })
      }
      await expect(agent.connection.agent.request(methods.agent.session.setMode, { sessionId, modeId: 'ask' })).rejects.toBeInstanceOf(
        RequestError
      )
      const resumed = await agent.connection.agent.request(methods.agent.session.resume, { sessionId, cwd: process.cwd(), mcpServers: [] })
      expect(resumed.modes?.currentModeId).toBe('bypassPermissions')
    })

    it('applies the model option and refuses an unknown model', async () => {
      const agent = startAgent()
      await agent.initialize()
      const sessionId = await agent.newSession()
      const answer = await agent.connection.agent.request(methods.agent.session.setConfigOption, {
        sessionId,
        configId: 'model',
        value: 'claude-opus-5-5'
      })
      expect(answer.configOptions).toMatchObject([{ id: 'model', currentValue: 'claude-opus-5-5' }])
      await expect(
        agent.connection.agent.request(methods.agent.session.setConfigOption, { sessionId, configId: 'model', value: 'other-model' })
      ).rejects.toBeInstanceOf(RequestError)
    })
  })

  // Added for story S7 of milestone m1-chat: the arguments in the start report, the capability
  // `additionalDirectories`, and the scenario `no-auto` (a model that cannot use the mode auto).
  describe('arguments, directories and the auto fallback', () => {
    const modeUpdates = (agent: Harness) => agent.updates.filter((update) => update.sessionUpdate === 'current_mode_update')

    it('reports the arguments after its script: the pipe name, then each argument that the client added', async () => {
      const { command, args } = control.agent
      const child = spawn(command, [...args, '--extra-flag'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      try {
        const start = await control.waitForEnvironment()
        expect(start.pid).toBe(child.pid)
        expect(start.args).toEqual([control.pipeName, '--extra-flag'])
      } finally {
        child.kill()
      }
      startAgent()
      expect((await control.waitForEnvironment()).args).toEqual([control.pipeName])
    })

    it('advertises additionalDirectories, as Claude Code does', async () => {
      const agent = startAgent()
      expect(await agent.initialize()).toMatchObject({ agentCapabilities: { sessionCapabilities: { resume: {}, additionalDirectories: {} } } })
    })

    it('falls back to acceptEdits and sends current_mode_update when the model of the session cannot use auto', async () => {
      await control.scenario('no-auto', { models: ['claude-haiku-5-5'] })
      const agent = startAgent()
      await agent.initialize()
      const sessionId = await agent.newSession()
      // The mode first, then the model: auto holds until the model changes.
      await agent.connection.agent.request(methods.agent.session.setMode, { sessionId, modeId: 'auto' })
      expect(modeUpdates(agent)).toEqual([])
      await agent.connection.agent.request(methods.agent.session.setConfigOption, { sessionId, configId: 'model', value: 'claude-haiku-5-5' })
      expect(modeUpdates(agent)).toEqual([{ sessionUpdate: 'current_mode_update', currentModeId: 'acceptEdits' }])
      const resumed = await agent.connection.agent.request(methods.agent.session.resume, { sessionId, cwd: process.cwd(), mcpServers: [] })
      expect(resumed.modes?.currentModeId).toBe('acceptEdits')
      expect(await agent.prompt(sessionId)).toEqual({ stopReason: 'end_turn' })
      expect(texts(agent.updates)).toEqual(['Hel', 'lo'])
    })

    it('also falls back when the model comes first and the mode auto follows', async () => {
      await control.scenario('no-auto', { models: ['claude-haiku-5-5'] })
      const agent = startAgent()
      await agent.initialize()
      const sessionId = await agent.newSession()
      await agent.connection.agent.request(methods.agent.session.setConfigOption, { sessionId, configId: 'model', value: 'claude-haiku-5-5' })
      expect(modeUpdates(agent)).toEqual([])
      await agent.connection.agent.request(methods.agent.session.setMode, { sessionId, modeId: 'auto' })
      expect(modeUpdates(agent)).toEqual([{ sessionUpdate: 'current_mode_update', currentModeId: 'acceptEdits' }])
    })

    it('keeps auto for a model that can use it, and in every other scenario', async () => {
      await control.scenario('no-auto', { models: ['claude-haiku-5-5'] })
      const first = startAgent()
      await first.initialize()
      const kept = await first.newSession()
      await first.connection.agent.request(methods.agent.session.setMode, { sessionId: kept, modeId: 'auto' })
      await first.connection.agent.request(methods.agent.session.setConfigOption, { sessionId: kept, configId: 'model', value: 'claude-opus-5-5' })
      expect(modeUpdates(first)).toEqual([])
      const resumed = await first.connection.agent.request(methods.agent.session.resume, { sessionId: kept, cwd: process.cwd(), mcpServers: [] })
      expect(resumed.modes?.currentModeId).toBe('auto')

      await control.scenario('text')
      const second = startAgent()
      await second.initialize()
      const other = await second.newSession()
      await second.connection.agent.request(methods.agent.session.setMode, { sessionId: other, modeId: 'auto' })
      await second.connection.agent.request(methods.agent.session.setConfigOption, { sessionId: other, configId: 'model', value: 'claude-haiku-5-5' })
      expect(modeUpdates(second)).toEqual([])
    })

    it('refuses the scenario no-auto without models, in the test', async () => {
      await expect(control.scenario('no-auto')).rejects.toThrow('needs `models`')
      await expect(control.scenario('no-auto', { models: [] })).rejects.toThrow('needs `models`')
    })
  })

  // Added for story S9 of milestone m1-chat: a child process that outlives its parent
  // (`docs/architecture.md`, Tests), and a gate before the agent ends after its stdin closes.
  describe('scenarios child-process and slow-exit', () => {
    /** Whether a process runs. Signal 0 only checks it. */
    const isRunning = (pid: number) => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }
    const started: number[] = []
    afterEach(() => {
      // The child outlives the agent by design, so the test ends it.
      for (const pid of started.splice(0)) if (isRunning(pid)) process.kill(pid)
    })

    it('starts a child process, reports it with its parent, and the child still runs after the agent ends', async () => {
      await control.scenario('child-process', { chunks: ['Started'] })
      const agent = startAgent()
      const pid = await control.waitForAgent()
      await agent.initialize()
      expect(await agent.prompt(await agent.newSession())).toEqual({ stopReason: 'end_turn' })
      const child = await control.waitForChild()
      started.push(child.pid)
      expect(texts(agent.updates)).toEqual(['Started'])
      expect(child.parent).toBe(pid)
      expect(control.children).toEqual([child])
      expect(isRunning(child.pid)).toBe(true)

      agent.child.stdin!.end()
      expect(await agent.exited).toBe(0)
      expect(isRunning(child.pid)).toBe(true)
    })

    it('waits at the exit gate after its stdin closes, and ends when the test opens the gate', async () => {
      await control.scenario('slow-exit', { gate: 'exit', chunks: ['Bye'] })
      const agent = startAgent()
      await agent.initialize()
      expect(await agent.prompt(await agent.newSession())).toEqual({ stopReason: 'end_turn' })
      expect(texts(agent.updates)).toEqual(['Bye'])

      agent.child.stdin!.end()
      await control.waitForGate('exit')
      // The agent reports the gate before it waits there, so it still runs now.
      expect(agent.child.exitCode).toBeNull()
      await control.open('exit')
      expect(await agent.exited).toBe(0)
    })

    it('ends at once after its stdin closes in every other scenario', async () => {
      await control.scenario('text')
      const agent = startAgent()
      await agent.initialize()
      await agent.prompt(await agent.newSession())
      agent.child.stdin!.end()
      expect(await agent.exited).toBe(0)
    })
  })

  describe('control channel', () => {
    it('changes the scenario of a running agent for the next prompt', async () => {
      await control.scenario('text')
      const agent = startAgent()
      await agent.initialize()
      const session = await agent.newSession()
      await agent.prompt(session)
      await control.scenario('sign-in-error')
      await expect(agent.prompt(session)).rejects.toMatchObject({ code: -32000 })
    })

    it('refuses an unknown scenario in the test, not in the agent', async () => {
      await expect(control.scenario('nope' as never)).rejects.toThrow('Unknown scenario "nope"')
    })

    it('runs the steps that a test sends', async () => {
      await control.scenario('steps', { prompt: [{ do: 'say', text: 'Custom' }, { do: 'gate', name: 'end' }] })
      const agent = startAgent()
      await agent.initialize()
      const turn = agent.prompt(await agent.newSession())
      await control.waitForGate('end')
      expect(texts(agent.updates)).toEqual(['Custom'])
      await control.open('end')
      await turn
    })

    it('serves more than one agent process on the same pipe', async () => {
      await control.scenario('text', { chunks: ['Again'] })
      const first = startAgent()
      await control.waitForAgent()
      const second = startAgent()
      await control.waitForAgent()
      for (const agent of [first, second]) {
        await agent.initialize()
        expect(await agent.prompt(await agent.newSession())).toEqual({ stopReason: 'end_turn' })
        expect(texts(agent.updates)).toEqual(['Again'])
      }
    })

    it('ends the agent when the control server closes', async () => {
      const agent = startAgent()
      await control.waitForAgent()
      await control.close()
      expect(await agent.exited).toBe(0)
    })
  })
})
