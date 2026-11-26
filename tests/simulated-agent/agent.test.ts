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
  connection: ClientConnection
  updates: Record<string, unknown>[]
  /** What the client answers to a permission request. */
  answer: RequestPermissionResponse
  permissions: unknown[]
  initialize(): Promise<unknown>
  newSession(): Promise<string>
  prompt(sessionId: string, text?: string): Promise<{ stopReason: string }>
}

let control: ControlServer
let harness: Harness[]

function startAgent(): Harness {
  const { command, args } = control.agent
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true })
  const exited = new Promise<number | null>((resolve) => child.once('exit', resolve))
  const updates: Record<string, unknown>[] = []
  const permissions: unknown[] = []
  const state = { answer: { outcome: { outcome: 'selected', optionId: 'yes' } } as RequestPermissionResponse }
  const app = client({ name: 'test' })
    .onNotification(methods.client.session.update, ({ params }) => {
      updates.push(params.update as Record<string, unknown>)
    })
    .onRequest(methods.client.session.requestPermission, ({ params }) => {
      permissions.push(params)
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
    connection,
    updates,
    permissions,
    get answer() {
      return state.answer
    },
    set answer(value) {
      state.answer = value
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
