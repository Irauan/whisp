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

  // Added for story S5 of milestone m1-chat: permission requests and form elicitations that do not
  // wait for the answer (`requests.mjs`), the answer reports, and the steps withdraw, answers and detach.
  describe('requests that do not wait for the answer', () => {
    interface AskedPermission {
      params: {
        toolCall: { toolCallId: string; title?: string; kind?: string; locations?: { path: string }[] }
        options: { optionId: string; name: string; kind: string }[]
      }
      /** Aborts when the agent sends `$/cancel_request` for this request. */
      signal: AbortSignal
      answer(value: RequestPermissionResponse): void
    }
    interface AskedElicitation {
      params: Record<string, unknown>
      signal: AbortSignal
      answer(value: unknown): void
      fail(error: RequestError): void
    }
    /** A bare client whose answers the test gives, one request at a time. */
    interface Asker {
      connection: ClientConnection
      updates: Record<string, unknown>[]
      permissions: AskedPermission[]
      elicitations: AskedElicitation[]
      /** Resolves when the client has `count` permission requests. */
      asked(count: number): Promise<void>
      /** Resolves when the client has `count` elicitations. */
      elicited(count: number): Promise<void>
      initialize(): Promise<unknown>
      newSession(): Promise<string>
      prompt(sessionId: string): Promise<{ stopReason: string }>
    }

    const askers: ChildProcess[] = []
    afterEach(() => {
      for (const child of askers) child.kill()
      askers.length = 0
    })

    function startAsker(): Asker {
      const { command, args } = control.agent
      const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true })
      askers.push(child)
      const updates: Record<string, unknown>[] = []
      const permissions: AskedPermission[] = []
      const elicitations: AskedElicitation[] = []
      let wake: () => void = () => undefined
      const until = async (check: () => boolean) => {
        while (!check()) await new Promise<void>((resolve) => (wake = resolve))
      }
      const app = client({ name: 'test' })
        .onNotification(methods.client.session.update, ({ params }) => {
          updates.push(params.update as Record<string, unknown>)
          wake()
        })
        .onRequest(
          methods.client.session.requestPermission,
          ({ params, signal }) =>
            new Promise<RequestPermissionResponse>((resolve) => {
              permissions.push({ params: params as unknown as AskedPermission['params'], signal, answer: resolve })
              wake()
            })
        )
        .onRequest(
          methods.client.elicitation.create,
          ({ params, signal }) =>
            new Promise<never>((resolve, reject) => {
              elicitations.push({ params: params as Record<string, unknown>, signal, answer: resolve as (value: unknown) => void, fail: reject })
              wake()
            })
        )
      const connection = app.connect(
        ndJsonStream(Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>)
      )
      return {
        connection,
        updates,
        permissions,
        elicitations,
        asked: (count) => until(() => permissions.length >= count),
        elicited: (count) => until(() => elicitations.length >= count),
        initialize: () =>
          connection.agent.request(methods.agent.initialize, {
            protocolVersion: PROTOCOL_VERSION,
            clientInfo: { name: 'test', version: '0' },
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, elicitation: { form: {} } }
          }),
        newSession: async () => (await connection.agent.request(methods.agent.session.new, { cwd: process.cwd(), mcpServers: [] })).sessionId,
        prompt: (sessionId) => connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: 'hello' }] })
      }
    }

    const selected = (optionId: string): RequestPermissionResponse => ({ outcome: { outcome: 'selected', optionId } })
    const cancelled: RequestPermissionResponse = { outcome: { outcome: 'cancelled' } }
    const aborted = (signal: AbortSignal) =>
      signal.aborted ? Promise.resolve() : new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
    const statusOf = (asker: Asker, id: string) =>
      asker.updates.filter((update) => update.toolCallId === id && update.sessionUpdate === 'tool_call_update').map((update) => update.status)

    it('asks two permissions at the same time, each for its own tool call, and reports each answer for its own request', async () => {
      await control.scenario('permissions', { reply: 'Both answered.' })
      const asker = startAsker()
      await asker.initialize()
      const turn = asker.prompt(await asker.newSession())
      // Both requests are open before the client answers one.
      await asker.asked(2)
      expect(asker.permissions.map(({ params }) => params.toolCall.toolCallId)).toEqual(['run-tests', 'read-log'])
      expect(asker.permissions.map(({ params }) => params.options.map(({ optionId }) => optionId))).toEqual([
        ['yes', 'no'],
        ['yes', 'no']
      ])
      expect(asker.updates.filter((update) => update.sessionUpdate === 'tool_call').map((update) => update.toolCallId)).toEqual([
        'run-tests',
        'read-log'
      ])

      // The client answers the second request first.
      asker.permissions[1]!.answer(selected('no'))
      expect(await control.waitForPermission('read-log')).toEqual({ id: 'read-log', outcome: { outcome: 'selected', optionId: 'no' } })
      asker.permissions[0]!.answer(selected('yes'))
      expect(await control.waitForPermission('run-tests')).toEqual({ id: 'run-tests', outcome: { outcome: 'selected', optionId: 'yes' } })
      expect(await turn).toEqual({ stopReason: 'end_turn' })
      expect(statusOf(asker, 'run-tests')).toEqual(['completed'])
      expect(statusOf(asker, 'read-log')).toEqual(['failed'])
      expect(texts(asker.updates)).toEqual(['Both answered.'])
      expect(control.permissionAnswers.map(({ id }) => id)).toEqual(['read-log', 'run-tests'])
    })

    it('sends the title, the kind, the locations and the options of each request, as the step gives them', async () => {
      const options = [
        { optionId: 'reject', name: 'No', kind: 'reject_once' },
        { optionId: 'allow', name: 'Yes', kind: 'allow_once' }
      ]
      await control.scenario('steps', {
        prompt: [
          { do: 'ask', requests: [{ id: 'remove', title: 'rm -rf build', kind: 'execute', locations: ['C:\\work\\build'], options }] },
          { do: 'answers' }
        ]
      })
      const asker = startAsker()
      await asker.initialize()
      const turn = asker.prompt(await asker.newSession())
      await asker.asked(1)
      expect(asker.permissions[0]!.params).toMatchObject({
        toolCall: { toolCallId: 'remove', title: 'rm -rf build', kind: 'execute', locations: [{ path: 'C:\\work\\build' }] },
        options
      })
      expect(asker.updates[0]).toMatchObject({ sessionUpdate: 'tool_call', toolCallId: 'remove', title: 'rm -rf build', kind: 'execute', status: 'pending' })
      asker.permissions[0]!.answer(cancelled)
      expect(await control.waitForPermission('remove')).toEqual({ id: 'remove', outcome: { outcome: 'cancelled' } })
      await turn
      expect(statusOf(asker, 'remove')).toEqual(['failed'])
    })

    it('offers the three options of a Claude Code shell command in the scenario always', async () => {
      await control.scenario('always')
      const asker = startAsker()
      await asker.initialize()
      const turn = asker.prompt(await asker.newSession())
      await asker.asked(1)
      expect(asker.permissions[0]!.params.options).toEqual([
        { optionId: 'allow', name: 'Yes', kind: 'allow_once' },
        { optionId: 'allow-always', name: "Yes, and don't ask again for npm test commands", kind: 'allow_always' },
        { optionId: 'reject', name: 'No', kind: 'reject_once' }
      ])
      asker.permissions[0]!.answer(selected('allow-always'))
      await turn
      expect(control.permissionAnswers).toEqual([{ id: 'run-tests', outcome: { outcome: 'selected', optionId: 'allow-always' } }])
      expect(statusOf(asker, 'run-tests')).toEqual(['completed'])
    })

    it('withdraws one open request with $/cancel_request, and the other request stays open', async () => {
      await control.scenario('steps', {
        prompt: [
          {
            do: 'ask',
            requests: [
              { id: 'first', title: 'Edit a.txt', kind: 'edit' },
              { id: 'second', title: 'Edit b.txt', kind: 'edit' }
            ]
          },
          { do: 'gate', name: 'withdraw' },
          { do: 'withdraw', id: 'first' },
          { do: 'answers' }
        ]
      })
      const asker = startAsker()
      await asker.initialize()
      const turn = asker.prompt(await asker.newSession())
      await asker.asked(2)
      await control.waitForGate('withdraw')
      expect(asker.permissions.map(({ signal }) => signal.aborted)).toEqual([false, false])
      await control.open('withdraw')
      await aborted(asker.permissions[0]!.signal)
      expect(asker.permissions.map(({ signal }) => signal.aborted)).toEqual([true, false])
      asker.permissions[0]!.answer(cancelled)
      asker.permissions[1]!.answer(selected('yes'))
      expect(await turn).toEqual({ stopReason: 'end_turn' })
      expect(control.permissionAnswers).toEqual([
        { id: 'first', outcome: { outcome: 'cancelled' } },
        { id: 'second', outcome: { outcome: 'selected', optionId: 'yes' } }
      ])
    })

    it('with withdrawOnCancel, a cancel of the turn also withdraws the open requests, and the turn ends as cancelled after the answers', async () => {
      await control.scenario('steps', {
        prompt: [
          { do: 'ask', withdrawOnCancel: true, requests: [{ id: 'only', title: 'npm test', kind: 'execute' }] },
          { do: 'answers' },
          { do: 'say', text: 'Not sent' }
        ]
      })
      const asker = startAsker()
      await asker.initialize()
      const session = await asker.newSession()
      const turn = asker.prompt(session)
      await asker.asked(1)
      await asker.connection.agent.notify(methods.agent.session.cancel, { sessionId: session })
      await aborted(asker.permissions[0]!.signal)
      asker.permissions[0]!.answer(cancelled)
      expect(await turn).toEqual({ stopReason: 'cancelled' })
      expect(await control.waitForPermission('only')).toEqual({ id: 'only', outcome: { outcome: 'cancelled' } })
      expect(texts(asker.updates)).toEqual([])
    })

    it('uses the mode of the chosen option and sends current_mode_update, as Claude Code does after a plan exit', async () => {
      const options = [
        { optionId: 'exit-plan-accept-edits', name: 'Yes, auto-accept edits', kind: 'allow_always' },
        { optionId: 'exit-plan-default', name: 'Yes, manually approve edits', kind: 'allow_once' },
        { optionId: 'reject', name: 'No, keep planning', kind: 'reject_once' }
      ]
      await control.scenario('steps', {
        prompt: [
          {
            do: 'ask',
            requests: [
              {
                id: 'plan',
                title: 'Approve Plan',
                kind: 'switch_mode',
                options,
                modes: { 'exit-plan-accept-edits': 'acceptEdits', 'exit-plan-default': 'default' }
              }
            ]
          },
          { do: 'answers' }
        ]
      })
      const asker = startAsker()
      await asker.initialize()
      const sessionId = await asker.newSession()
      await asker.connection.agent.request(methods.agent.session.setMode, { sessionId, modeId: 'plan' })
      const turn = asker.prompt(sessionId)
      await asker.asked(1)
      expect(asker.permissions[0]!.params.options).toEqual(options)
      asker.permissions[0]!.answer(selected('exit-plan-accept-edits'))
      await turn
      expect(asker.updates.filter((update) => update.sessionUpdate === 'current_mode_update')).toEqual([
        { sessionUpdate: 'current_mode_update', currentModeId: 'acceptEdits' }
      ])
      const resumed = await asker.connection.agent.request(methods.agent.session.resume, { sessionId, cwd: process.cwd(), mcpServers: [] })
      expect(resumed.modes?.currentModeId).toBe('acceptEdits')
    })

    it('sends a form elicitation with the session ID, and reports the answer of the client', async () => {
      const request = {
        mode: 'form',
        toolCallId: 'ask-1',
        message: 'Which test runner do you want?',
        requestedSchema: {
          type: 'object',
          properties: {
            question_0: { type: 'string', title: 'Runner', oneOf: [{ const: 'Vitest', title: 'Vitest', description: 'Fast.' }] },
            question_0_custom: { type: 'string', title: 'Other', description: 'Type your own answer.' }
          }
        }
      }
      await control.scenario('steps', { prompt: [{ do: 'elicit', id: 'runner', request }, { do: 'answers' }, { do: 'say', text: 'Thanks.' }] })
      const asker = startAsker()
      await asker.initialize()
      const sessionId = await asker.newSession()
      const turn = asker.prompt(sessionId)
      await asker.elicited(1)
      expect(asker.elicitations[0]!.params).toEqual({ sessionId, ...request })
      asker.elicitations[0]!.answer({ action: 'accept', content: { question_0: 'Vitest' } })
      expect(await control.waitForElicitation('runner')).toEqual({ id: 'runner', response: { action: 'accept', content: { question_0: 'Vitest' } } })
      expect(await turn).toEqual({ stopReason: 'end_turn' })
      expect(texts(asker.updates)).toEqual(['Thanks.'])
    })

    it('withdraws an open elicitation with $/cancel_request', async () => {
      const request = { mode: 'form', message: 'Your name?', requestedSchema: { type: 'object', properties: { name: { type: 'string', title: 'Name' } } } }
      await control.scenario('steps', {
        prompt: [{ do: 'elicit', id: 'name', request }, { do: 'gate', name: 'withdraw' }, { do: 'withdraw', id: 'name' }, { do: 'answers' }]
      })
      const asker = startAsker()
      await asker.initialize()
      const turn = asker.prompt(await asker.newSession())
      await asker.elicited(1)
      await control.open('withdraw')
      await aborted(asker.elicitations[0]!.signal)
      asker.elicitations[0]!.answer({ action: 'cancel' })
      expect(await control.waitForElicitation('name')).toEqual({ id: 'name', response: { action: 'cancel' } })
      expect(await turn).toEqual({ stopReason: 'end_turn' })
    })

    it('reports an error answer of an elicitation, such as -32602 for a form that the client cannot render', async () => {
      const request = { mode: 'form', message: 'How many?', requestedSchema: { type: 'object', properties: { count: { type: 'number', title: 'Count' } } } }
      await control.scenario('steps', { prompt: [{ do: 'elicit', id: 'count', request }, { do: 'answers' }] })
      const asker = startAsker()
      await asker.initialize()
      const turn = asker.prompt(await asker.newSession())
      await asker.elicited(1)
      asker.elicitations[0]!.fail(RequestError.invalidParams(undefined, 'Unsupported field'))
      expect(await control.waitForElicitation('count')).toMatchObject({ id: 'count', error: { code: -32602 } })
      expect(await turn).toEqual({ stopReason: 'end_turn' })
      expect(control.elicitationAnswers).toHaveLength(1)
    })

    it('switches to the fallback model after an accept with retry_fallback, and sends config_option_update', async () => {
      const request = {
        mode: 'form',
        message: 'claude-fable-5-2 declined this request. Retry with claude-opus-5-5?',
        requestedSchema: {
          type: 'object',
          properties: {
            choice: {
              type: 'string',
              oneOf: [
                { const: 'retry_fallback', title: 'Retry with claude-opus-5-5', description: 'The session continues on claude-opus-5-5.' },
                { const: 'cancelled', title: 'Keep the refusal', description: 'You can send a new message.' }
              ]
            }
          }
        }
      }
      await control.scenario('steps', { prompt: [{ do: 'elicit', id: 'fallback', request, fallbackModel: 'claude-opus-5-5' }, { do: 'answers' }] })
      const asker = startAsker()
      await asker.initialize()
      const sessionId = await asker.newSession()
      const turn = asker.prompt(sessionId)
      await asker.elicited(1)
      asker.elicitations[0]!.answer({ action: 'accept', content: { choice: 'retry_fallback' } })
      await turn
      const updates = asker.updates.filter((update) => update.sessionUpdate === 'config_option_update')
      expect(updates).toHaveLength(1)
      expect(updates[0]).toMatchObject({ configOptions: [{ id: 'model', currentValue: 'claude-opus-5-5' }] })
      const resumed = await asker.connection.agent.request(methods.agent.session.resume, { sessionId, cwd: process.cwd(), mcpServers: [] })
      expect(resumed.configOptions).toMatchObject([{ id: 'model', currentValue: 'claude-opus-5-5' }])
    })

    it('keeps the model after "Keep the refusal": no config_option_update', async () => {
      const request = {
        mode: 'form',
        message: 'claude-fable-5-2 declined this request. Retry with claude-opus-5-5?',
        requestedSchema: {
          type: 'object',
          properties: {
            choice: {
              type: 'string',
              oneOf: [
                { const: 'retry_fallback', title: 'Retry with claude-opus-5-5' },
                { const: 'cancelled', title: 'Keep the refusal' }
              ]
            }
          }
        }
      }
      await control.scenario('steps', { prompt: [{ do: 'elicit', id: 'fallback', request, fallbackModel: 'claude-opus-5-5' }, { do: 'answers' }] })
      const asker = startAsker()
      await asker.initialize()
      const turn = asker.prompt(await asker.newSession())
      await asker.elicited(1)
      asker.elicitations[0]!.answer({ action: 'accept', content: { choice: 'cancelled' } })
      await turn
      expect(asker.updates.filter((update) => update.sessionUpdate === 'config_option_update')).toEqual([])
    })

    it('runs detached steps outside the turn: the turn ends, and the request comes when the test opens the gate', async () => {
      await control.scenario('steps', {
        prompt: [
          { do: 'say', text: 'I start a background task.' },
          {
            do: 'detach',
            steps: [{ do: 'gate', name: 'later' }, { do: 'ask', requests: [{ id: 'background', title: 'npm run build', kind: 'execute' }] }, { do: 'answers' }]
          }
        ]
      })
      const asker = startAsker()
      await asker.initialize()
      expect(await asker.prompt(await asker.newSession())).toEqual({ stopReason: 'end_turn' })
      await control.waitForGate('later')
      expect(asker.permissions).toEqual([])
      await control.open('later')
      await asker.asked(1)
      expect(asker.permissions[0]!.params.toolCall.toolCallId).toBe('background')
      asker.permissions[0]!.answer(selected('yes'))
      expect(await control.waitForPermission('background')).toEqual({ id: 'background', outcome: { outcome: 'selected', optionId: 'yes' } })
    })

    it('fails the turn on a withdraw of a request that is not open', async () => {
      await control.scenario('steps', { prompt: [{ do: 'withdraw', id: 'none' }] })
      const asker = startAsker()
      await asker.initialize()
      await expect(asker.prompt(await asker.newSession())).rejects.toBeDefined()
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
