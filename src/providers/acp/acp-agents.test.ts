import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ControlServer } from '../../../tests/simulated-agent/control'
import { err, ok } from '../../building-blocks/result'
import type { AgentListener, AgentProcess, AgentStartInput, AgentUpdate, Elicitation, PermissionRequest } from '../../building-blocks/agent.port'
import { splitLog } from '../../shared/log-marker'
import { claudeCodeRecipe } from '../claude-code/claude-code'
import { AcpAgents, translateUpdate, type AcpOptions } from './acp-agents'
import { isRunning, type Powershell } from './process-tree'

let control: ControlServer
let folder: string
let opened: AgentProcess[]
let aether: Record<string, string>

beforeEach(async () => {
  control = await ControlServer.start()
  folder = await mkdtemp(join(tmpdir(), 'aether-acp-'))
  opened = []
  aether = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', ANTHROPIC_API_KEY: 'x', FOO: 'y', GH_TOKEN: 'fake-token-of-aether' }
})

afterEach(async () => {
  await Promise.all(opened.map((agent) => agent.close()))
  await control.close()
  await rm(folder, { recursive: true, force: true })
})

const agents = (extra: Partial<AcpOptions> = {}) =>
  new AcpAgents({ recipe: claudeCodeRecipe({ override: async () => ok(control.agent) }), environment: () => aether, closeLimitMs: 2000, ...extra })

const input = (part: Partial<AgentStartInput> = {}): AgentStartInput => ({
  mainDirectory: folder,
  additionalDirectories: [],
  model: 'default',
  mode: 'ask',
  sharedItems: [],
  settings: {},
  environment: {},
  resume: null,
  ...part
})

interface Listened {
  updates: AgentUpdate[]
  exits: { code: number | null; logTail: string }[]
  /** The permission requests that opened, and the forms. */
  permissions: PermissionRequest[]
  elicitations: Elicitation[]
  /** The requests that closed by themselves, in order: `permission` or `elicitation`, the ID, the reason. */
  closed: [string, string, string][]
  listener: AgentListener
}

function listen(): Listened {
  const updates: AgentUpdate[] = []
  const exits: Listened['exits'] = []
  const permissions: PermissionRequest[] = []
  const elicitations: Elicitation[] = []
  const closed: Listened['closed'] = []
  return {
    updates,
    exits,
    permissions,
    elicitations,
    closed,
    listener: {
      update: (update) => updates.push(update),
      exited: (info) => exits.push(info),
      permission: (request) => permissions.push(request),
      permissionClosed: (id, reason) => closed.push(['permission', id, reason]),
      elicitation: (form) => elicitations.push(form),
      elicitationClosed: (id, reason) => closed.push(['elicitation', id, reason])
    }
  }
}

function start(part: Partial<AgentStartInput> = {}, listened: Listened = listen(), extra: Partial<AcpOptions> = {}): AgentProcess {
  const process = agents(extra).start(input(part), listened.listener)
  opened.push(process)
  return process
}

describe('AcpAgents, first message and mode report', () => {
  it('sends the text, then one resource_link for each file or folder, with a file: URI and the name', async () => {
    const file = join(folder, 'notes.txt')
    const other = join(folder, 'other folder')
    const process = start()
    expect((await process.ready).ok).toBe(true)
    expect(await process.prompt('Read these', [{ path: file, name: 'notes.txt' }, { path: other, name: 'other folder' }])).toEqual({ ok: true, value: 'end_turn' })
    expect(control.received('session/prompt')[0]?.params).toMatchObject({
      sessionId: 's1',
      prompt: [
        { type: 'text', text: 'Read these' },
        { type: 'resource_link', uri: pathToFileURL(file).href, name: 'notes.txt' },
        { type: 'resource_link', uri: pathToFileURL(other).href, name: 'other folder' }
      ]
    })
  })

  it('sends only the text when the message has no link', async () => {
    const process = start()
    await process.ready
    await process.prompt('Say hello')
    expect(control.received('session/prompt')[0]?.params).toMatchObject({ prompt: [{ type: 'text', text: 'Say hello' }] })
  })

  it('reports the mode that the agent falls back to: Auto with a model that cannot use it gives accept-edits', async () => {
    await control.scenario('no-auto', { models: ['claude-haiku-5-5'] })
    const listened = listen()
    const process = start({ mode: 'auto', model: 'claude-haiku-5-5' }, listened)
    expect((await process.ready).ok).toBe(true)
    expect(control.received('session/set_mode')[0]?.params).toMatchObject({ modeId: 'auto' })
    expect(listened.updates).toEqual([{ type: 'mode', mode: 'accept-edits' }])
  })

  it('reports no mode change when the model can use Auto', async () => {
    await control.scenario('no-auto', { models: ['claude-haiku-5-5'] })
    const listened = listen()
    const process = start({ mode: 'auto', model: 'claude-opus-5-5' }, listened)
    expect((await process.ready).ok).toBe(true)
    expect(listened.updates).toEqual([])
  })
})

describe('AcpAgents', () => {
  it('starts one session in the main directory and sets the mode before the first prompt', async () => {
    const process = start({ mode: 'plan' })
    const ready = await process.ready
    expect(ready).toMatchObject({ ok: true, value: { agentSessionId: 's1', resumed: false, resumeError: null } })
    expect(await process.prompt('Say hello')).toEqual({ ok: true, value: 'end_turn' })
    const methods = control.messages.map((message) => message.method)
    expect(methods.indexOf('session/set_mode')).toBeGreaterThan(methods.indexOf('session/new'))
    expect(methods.indexOf('session/set_mode')).toBeLessThan(methods.indexOf('session/prompt'))
    expect(control.received('session/new')[0]?.params).toMatchObject({ cwd: folder })
    expect(control.received('session/set_mode')[0]?.params).toMatchObject({ sessionId: 's1', modeId: 'plan' })
  })

  it.each([
    ['ask', 'default'],
    ['accept-edits', 'acceptEdits'],
    ['plan', 'plan'],
    ['auto', 'auto'],
    ['approve-all', 'bypassPermissions']
  ] as const)('sends the Claude mode of %s: %s', async (mode, claude) => {
    const process = start({ mode })
    expect((await process.ready).ok).toBe(true)
    expect(control.received('session/set_mode')[0]?.params).toMatchObject({ modeId: claude })
  })

  it('sends additional directories with the session, and the model as a configuration option', async () => {
    const extra = join(folder, 'extra')
    const process = start({ additionalDirectories: [extra], model: 'claude-opus-5-5' })
    expect((await process.ready).ok).toBe(true)
    expect(control.received('session/new')[0]?.params).toMatchObject({ additionalDirectories: [extra] })
    expect(control.received('session/set_config_option')[0]?.params).toMatchObject({ configId: 'model', value: 'claude-opus-5-5' })
  })

  it('sends no model for the model "default"', async () => {
    const process = start()
    expect((await process.ready).ok).toBe(true)
    expect(control.received('session/set_config_option')).toHaveLength(0)
  })

  it('does not start when the agent refuses the model, and ends the process', async () => {
    const process = start({ model: 'claude-unknown-9' })
    expect(await process.ready).toMatchObject({ ok: false, error: { code: 'settings-refused' } })
    const pid = await control.waitForClose()
    expect(pid).toBeTypeOf('number')
    expect(control.received('session/prompt')).toHaveLength(0)
  })

  it('passes the updates of a turn to the listener as updates of the port, in order', async () => {
    await control.scenario('steps', {
      prompt: [
        { do: 'say', text: 'Hello ' },
        { do: 'update', update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hm' } } },
        { do: 'update', update: { sessionUpdate: 'tool_call', toolCallId: 't9', title: 'Run it', kind: 'execute', status: 'in_progress' } },
        { do: 'update', update: { sessionUpdate: 'tool_call_update', toolCallId: 't9', status: 'completed' } },
        {
          do: 'update',
          update: {
            sessionUpdate: 'plan',
            entries: [
              { content: 'One', priority: 'high', status: 'completed' },
              { content: 'Two', priority: 'low', status: 'in_progress' },
              { content: 'Three', priority: 'low', status: 'pending' }
            ]
          }
        },
        { do: 'say', text: 'from the agent.' }
      ]
    })
    const listened = listen()
    const process = start({}, listened)
    await process.ready
    await process.prompt('go')
    expect(listened.updates).toEqual([
      { type: 'text', text: 'Hello ' },
      { type: 'thought', text: 'hm' },
      { type: 'tool', id: 't9', title: 'Run it', toolKind: 'execute', status: 'in_progress' },
      { type: 'tool-update', id: 't9', title: null, toolKind: null, status: 'completed' },
      {
        type: 'plan',
        steps: [
          { text: 'One', status: 'completed' },
          { text: 'Two', status: 'in_progress' },
          { text: 'Three', status: 'pending' }
        ]
      },
      { type: 'text', text: 'from the agent.' }
    ])
  })

  it('cancels a turn: the prompt ends with the stop reason "cancelled"', async () => {
    await control.scenario('text', { gate: 'never' })
    const process = start()
    await process.ready
    const turn = process.prompt('go')
    await control.waitForGate('never')
    await process.cancel()
    expect(await turn).toEqual({ ok: true, value: 'cancelled' })
    expect(control.received('session/cancel')[0]?.params).toMatchObject({ sessionId: 's1' })
  })

  it('cancels a start that is not ready: the process ends and ready gives "cancelled"', async () => {
    await control.scenario('slow-start', { gate: 'initialize' })
    const process = start()
    await control.waitForGate('initialize')
    await process.cancel()
    expect(await process.ready).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    expect(await control.waitForClose()).toBeTypeOf('number')
  })

  it('gives each session its own process, also when both start before either is ready', async () => {
    await control.scenario('slow-start', { gate: 'initialize', chunks: ['Hi'] })
    const first = listen()
    const second = listen()
    const one = start({}, first)
    const two = start({}, second)
    await control.waitForGate('initialize')
    await control.waitForGate('initialize')
    await control.open('initialize')
    expect((await one.ready).ok && (await two.ready).ok).toBe(true)
    expect(new Set(control.pids).size).toBe(2)
    expect(await one.prompt('a')).toEqual({ ok: true, value: 'end_turn' })
    expect(await two.prompt('b')).toEqual({ ok: true, value: 'end_turn' })
    expect(first.updates).toEqual([{ type: 'text', text: 'Hi' }])
    expect(second.updates).toEqual([{ type: 'text', text: 'Hi' }])
  })

  it('resumes the agent session of the input in a new process', async () => {
    const first = start()
    expect(await first.ready).toMatchObject({ ok: true, value: { agentSessionId: 's1' } })
    await first.close()
    const second = start({ resume: 's1' })
    expect(await second.ready).toMatchObject({ ok: true, value: { agentSessionId: 's1', resumed: true, resumeError: null } })
    expect(control.received('session/resume')[0]?.params).toMatchObject({ sessionId: 's1', cwd: folder })
    expect(control.received('session/new')).toHaveLength(1)
    // The mode applies to a resumed session too.
    expect(control.received('session/set_mode')).toHaveLength(2)
    // Each close lists the process tree first (S9-4): two closes need a longer limit than the default.
  }, 30_000)

  it('starts a new agent session when the resume fails, and says why', async () => {
    const process = start({ resume: 'unknown-session' })
    const ready = await process.ready
    expect(ready).toMatchObject({ ok: true, value: { agentSessionId: 's1', resumed: false } })
    expect(ready.ok && ready.value.resumeError).toMatch(/Unknown session/)
    expect(control.received('session/new')).toHaveLength(1)
  })

  it('maps "auth required" to not-signed-in, with the sign-in steps of the settings', async () => {
    await control.scenario('sign-in-error')
    const process = start({ settings: { configFolder: 'C:\\claude-folder' } })
    await process.ready
    const result = await process.prompt('go')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('not-signed-in')
    expect(result.error.message).toMatch(/^Claude Code is not signed in\. /)
    expect(result.error.message).toContain('C:\\claude-folder')
    expect(result.error.message).toContain('subscription')
  })

  it('reports the exit code and the last log lines when the process ends during a turn, once', async () => {
    await control.scenario('crash', { exitCode: 7, log: 'simulated agent: the disk is full' })
    const listened = listen()
    const process = start({}, listened)
    await process.ready
    const result = await process.prompt('go')
    expect(result).toMatchObject({ ok: false, error: { code: 'agent-stopped' } })
    expect(!result.ok && result.error.message).toMatch(/exit code 7/)
    expect(!result.ok && result.error.message).toContain('simulated agent: the disk is full')
    expect(listened.exits).toHaveLength(1)
    expect(listened.exits[0]?.code).toBe(7)
  })

  it('puts the last log lines of a stopped agent and of a failed start behind the marker line', async () => {
    await control.scenario('crash', { exitCode: 7, log: 'simulated agent: the disk is full' })
    const process = start()
    await process.ready
    const stopped = await process.prompt('go')
    expect(!stopped.ok && splitLog(stopped.error.message)).toEqual({
      message: expect.stringMatching(/^Claude Code stopped \(exit code 7\)\.$/),
      log: 'simulated agent: the disk is full'
    })

    await control.scenario('steps', {
      initialize: [{ do: 'log', text: 'simulated agent: no config' }, { do: 'fail', code: -32603, message: 'The first\nline of the start error' }]
    })
    const starting = start()
    const ready = await starting.ready
    expect(ready).toMatchObject({ ok: false, error: { code: 'failed' } })
    expect(!ready.ok && splitLog(ready.error.message)).toEqual({
      message: expect.stringMatching(/^Claude Code did not start\. The first\nline of the start error$/),
      log: 'simulated agent: no config'
    })
  })

  it('removes the values that Aether gave the agent from the log lines', async () => {
    await control.scenario('crash', { exitCode: 1, log: 'token is fake-token-of-two here' })
    const process = start({ environment: { GH_TOKEN: 'fake-token-of-two' } })
    await process.ready
    const result = await process.prompt('go')
    expect(!result.ok && result.error.message).toContain('token is [removed] here')
    expect(!result.ok && result.error.message).not.toContain('fake-token-of-two')
  })

  it('removes the values that Aether gave the agent from the message of a failed prompt and of a failed start', async () => {
    const token = 'fake-token-of-two'
    await control.scenario('steps', { prompt: [{ do: 'fail', code: -32603, message: `The call used ${token} and failed` }] })
    const prompting = start({ environment: { GH_TOKEN: token } })
    await prompting.ready
    const answer = await prompting.prompt('go')
    expect(answer).toMatchObject({ ok: false, error: { code: 'failed' } })
    expect(!answer.ok && answer.error.message).toContain('The call used [removed] and failed')
    expect(!answer.ok && answer.error.message).not.toContain(token)

    await control.scenario('steps', { initialize: [{ do: 'fail', code: -32603, message: `Start with ${token} failed` }] })
    const starting = start({ environment: { GH_TOKEN: token } })
    const ready = await starting.ready
    expect(ready).toMatchObject({ ok: false, error: { code: 'failed' } })
    expect(!ready.ok && ready.error.message).toContain('Start with [removed] failed')
    expect(!ready.ok && ready.error.message).not.toContain(token)
  })

  it('refuses the start with "unavailable" and starts no process when the recipe cannot launch', async () => {
    const message = 'The entry "claude-code" in agents.json names a program that Aether cannot find: C:\\gone.exe. Fix the entry or remove it.'
    const refusing = new AcpAgents({ recipe: claudeCodeRecipe({ override: async () => err('override-unavailable', message) }), environment: () => aether })
    const process = refusing.start(input(), listen().listener)
    opened.push(process)
    expect(await process.ready).toEqual({ ok: false, error: { code: 'unavailable', message } })
    expect(control.pids).toHaveLength(0)
  })

  it('builds the environment from the allow list, the Claude settings and the input', async () => {
    const process = start({
      settings: { configFolder: 'C:\\claude-folder' },
      environment: { GH_TOKEN: 'fake-token-of-two' }
    })
    const { env } = await control.waitForEnvironment()
    await process.ready
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.FOO).toBeUndefined()
    expect(env.PATH ?? env.Path).toBe(aether.PATH)
    expect(env.GH_TOKEN).toBe('fake-token-of-two')
    expect(env.CLAUDE_CONFIG_DIR).toBe('C:\\claude-folder')
    expect(env.ANTHROPIC_PROFILE).toBeUndefined()
  })

  it('refuses the start when the settings are not valid for the provider', async () => {
    const process = start({ settings: { configFolder: 42 } })
    expect(await process.ready).toMatchObject({ ok: false, error: { code: 'unavailable' } })
  })

  it('ends the process on close, and close can run twice', async () => {
    const listened = listen()
    const process = start({}, listened)
    await process.ready
    await Promise.all([process.close(), process.close()])
    expect(listened.exits).toHaveLength(1)
    expect(await control.waitForClose()).toBeTypeOf('number')
  })

  it('ends the child process of the agent on close, also when the agent ends by itself after its stdin closed (S9-4)', async () => {
    await control.scenario('child-process', { chunks: ['Hello'] })
    const process = start()
    await process.ready
    await process.prompt('go')
    const child = await control.waitForChild()
    try {
      expect(isRunning(child.pid), 'the child runs before the close').toBe(true)
      await process.close()
      // The close waits for the end of the tree, so no poll is needed.
      expect(isRunning(child.pid), 'the child of the agent outlived the close').toBe(false)
    } finally {
      // The test never leaves the child alive, also when the close failed.
      if (isRunning(child.pid)) globalThis.process.kill(child.pid)
    }
  }, 30_000)

  it('ends the agent and its whole tree with taskkill when the list fails, logs it, and the process counts as closed (S1, user decision 2026-11-27)', async () => {
    await control.scenario('child-process', { chunks: ['Hello'] })
    const logged: string[] = []
    let listed = 0
    const powershell: Powershell = async () => {
      listed += 1
      return { ok: false, detail: 'code 1, signal null, killed true' }
    }
    const listened = listen()
    const process = start({}, listened, { powershell, log: (message) => logged.push(message) })
    await process.ready
    await process.prompt('go')
    const child = await control.waitForChild()
    const agent = control.pids[0]!
    try {
      expect(child.parent, 'the child belongs to the agent').toBe(agent)
      expect(isRunning(child.pid)).toBe(true)
      await process.close()
      // The list failed once, and it is logged.
      expect(listed).toBe(1)
      expect(logged).toHaveLength(1)
      expect(logged[0]).toMatch(/could not list the processes.*killed true.*taskkill/)
      // `taskkill /T /F` ran on the agent while it ran, so it ended the agent and the child that would outlive it.
      expect(isRunning(agent), 'the agent still runs').toBe(false)
      expect(isRunning(child.pid), 'the child of the agent outlived the forced kill').toBe(false)
      // The close resolved and the exit was reported: the next start can go on (rules 7 and 8).
      expect(listened.exits).toHaveLength(1)
      await process.close()
    } finally {
      if (isRunning(child.pid)) globalThis.process.kill(child.pid)
    }
  }, 30_000)

  it('runs no taskkill when the agent ended while the failed list ran: its number can belong to another process now (round 3)', async () => {
    await control.scenario('text', { chunks: ['Hello'] })
    const logged: string[] = []
    const killed: (number | undefined)[] = []
    let called: () => void = () => undefined
    const listCalled = new Promise<void>((resolve) => (called = resolve))
    let failList: () => void = () => undefined
    const listHeld = new Promise<void>((resolve) => (failList = resolve))
    const powershell: Powershell = async () => {
      called()
      await listHeld
      return { ok: false, detail: 'code 1, signal null, killed true' }
    }
    const listened = listen()
    const process = start({}, listened, {
      powershell,
      log: (message) => logged.push(message),
      killTree: async (child) => void killed.push(child.pid)
    })
    await process.ready
    const agent = control.pids[0]!
    const closing = process.close()
    await listCalled
    // The agent ends while the list runs.
    globalThis.process.kill(agent)
    await expect.poll(() => listened.exits.length, { message: 'the agent did not end' }).toBe(1)
    failList()
    await closing
    expect(killed, 'taskkill ran on the number of an agent that had ended').toEqual([])
    expect(logged).toHaveLength(2)
    expect(logged[1]).toMatch(/ended while the list/)
  }, 30_000)

  it('runs taskkill on the agent while it still runs when the list fails, and logs a wait after the kill that times out (round 3)', async () => {
    await control.scenario('text', { chunks: ['Hello'] })
    const logged: string[] = []
    const killed: (number | undefined)[] = []
    const powershell: Powershell = async () => ({ ok: false, detail: 'code 1, signal null, killed false' })
    // The kill does nothing, so the agent does not end and the wait after it times out.
    const process = start({}, listen(), {
      powershell,
      log: (message) => logged.push(message),
      killTree: async (child) => void killed.push(child.pid),
      closeLimitMs: 300
    })
    await process.ready
    const agent = control.pids[0]!
    try {
      await process.close()
      expect(killed).toEqual([agent])
      expect(logged).toHaveLength(2)
      expect(logged[1]).toMatch(/did not end after the forced kill/)
    } finally {
      if (isRunning(agent)) globalThis.process.kill(agent)
    }
  }, 30_000)

  it('sends the cancel while the list of the process tree runs, and closes stdin after the list (S2, rule 9)', async () => {
    await control.scenario('text', { gate: 'hold', chunks: ['Hello'] })
    let called: () => void = () => undefined
    const listCalled = new Promise<void>((resolve) => (called = resolve))
    let finishList: () => void = () => undefined
    const listHeld = new Promise<void>((resolve) => (finishList = resolve))
    const powershell: Powershell = async () => {
      called()
      await listHeld
      return { ok: true, stdout: '' }
    }
    const process = start({}, listen(), { powershell, log: () => undefined })
    await process.ready
    const turn = process.prompt('go')
    await control.waitForGate('hold')
    const closing = process.close()
    await listCalled
    // The list is held open: the agent got the cancel, and its stdin is still open, so it still runs.
    await expect.poll(() => control.received('session/cancel').length, { message: 'the agent got no cancel while the list ran' }).toBe(1)
    expect(isRunning(control.pids[0]!), 'stdin closed before the list ended').toBe(true)
    finishList()
    await closing
    await turn
    expect(isRunning(control.pids[0]!)).toBe(false)
  }, 30_000)
})

describe('translateUpdate', () => {
  const { modeOf } = claudeCodeRecipe()

  it('gives a mode update as the mode of the port, and ignores a mode ID that the port does not know', () => {
    expect(translateUpdate({ sessionUpdate: 'current_mode_update', currentModeId: 'acceptEdits' }, modeOf)).toEqual({ type: 'mode', mode: 'accept-edits' })
    expect(translateUpdate({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' }, modeOf)).toEqual({ type: 'mode', mode: 'plan' })
    expect(translateUpdate({ sessionUpdate: 'current_mode_update', currentModeId: 'dontAsk' }, modeOf)).toBeNull()
  })

  it('ignores the updates that Aether does not show', () => {
    expect(translateUpdate({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' })).toBeNull()
    expect(translateUpdate({ sessionUpdate: 'agent_message_chunk', content: { type: 'image', data: '', mimeType: 'image/png' } })).toBeNull()
  })

  it('gives a session_info_update with a string title as the title of the port, and no update for the other ones', () => {
    expect(translateUpdate({ sessionUpdate: 'session_info_update', title: 'Greeting test', updatedAt: '2026-11-28T10:00:00.000Z', _meta: { a: 1 } })).toEqual({
      type: 'title',
      title: 'Greeting test'
    })
    expect(translateUpdate({ sessionUpdate: 'session_info_update', title: null, updatedAt: '2026-11-28T10:00:00.000Z' })).toBeNull()
    expect(translateUpdate({ sessionUpdate: 'session_info_update', _meta: { promptSuggestion: 'Try the tests' } })).toBeNull()
    expect(translateUpdate({ sessionUpdate: 'session_info_update', title: 7 as never })).toBeNull()
  })

  it('gives an unknown tool status as null in an update, and as pending in a new call', () => {
    expect(translateUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'a', status: 'weird' as never })).toMatchObject({ status: null })
    expect(translateUpdate({ sessionUpdate: 'tool_call', toolCallId: 'a', title: 't', status: 'weird' as never })).toMatchObject({ status: 'pending' })
  })
})

describe('AcpAgents, permission requests', () => {
  const ASK_ONE = [{ do: 'ask', requests: [{ id: 'run-tests', title: 'npm test', kind: 'execute', locations: ['C:\\work\\a.txt'] }] }]
  const waitFor = async <T>(read: () => T | undefined, what: string): Promise<T> => {
    for (let wait = 0; wait < 400; wait += 1) {
      const value = read()
      if (value !== undefined) return value
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(`Timeout: ${what}`)
  }

  it('declares the form elicitation and no other kind', async () => {
    const process = start()
    expect((await process.ready).ok).toBe(true)
    const capabilities = (control.received('initialize')[0]?.params as { clientCapabilities?: { elicitation?: unknown } }).clientCapabilities
    expect(capabilities?.elicitation).toEqual({ form: {} })
  })

  it('keeps a request open, maps its options and its tool, and answers that request only', async () => {
    await control.scenario('steps', { prompt: [{ do: 'ask', requests: [{ id: 'a' , title: 'npm test', kind: 'execute', locations: ['C:\\work\\a.txt'] }, { id: 'b', title: 'Read log', kind: 'read' }] }, { do: 'answers' }] })
    const listened = listen()
    const process = start({}, listened)
    await process.ready
    const turn = process.prompt('Run it')
    await waitFor(() => (listened.permissions.length === 2 ? true : undefined), 'two requests')
    const [first, second] = listened.permissions as [PermissionRequest, PermissionRequest]
    expect(first).toMatchObject({
      toolId: 'a',
      title: 'npm test',
      toolKind: 'execute',
      locations: ['C:\\work\\a.txt'],
      options: [
        { id: 'yes', label: 'Allow', kind: 'allow-once' },
        { id: 'no', label: 'Refuse', kind: 'refuse-once' }
      ]
    })
    expect(first.id).not.toBe(second.id)
    expect(control.permissionAnswers).toEqual([])

    expect(process.answer(second.id, 'yes')).toEqual({ ok: true, value: true })
    expect(await control.waitForPermission('b')).toEqual({ id: 'b', outcome: { outcome: 'selected', optionId: 'yes' } })
    expect(control.permissionAnswers.map(({ id }) => id)).toEqual(['b'])
    expect(process.answer(first.id, 'no')).toEqual({ ok: true, value: true })
    expect(await turn).toEqual({ ok: true, value: 'end_turn' })
    expect(control.permissionAnswers).toHaveLength(2)
  })

  it('refuses an unknown request, an option that was not offered and a second answer, and the agent gets nothing', async () => {
    await control.scenario('steps', { prompt: [...ASK_ONE, { do: 'answers' }] })
    const listened = listen()
    const process = start({}, listened)
    await process.ready
    const turn = process.prompt('Run it')
    const request = await waitFor(() => listened.permissions[0], 'the request')
    expect(process.answer('nope', 'yes')).toMatchObject({ ok: false, error: { code: 'unknown-request' } })
    expect(process.answer(request.id, 'other')).toMatchObject({ ok: false, error: { code: 'unknown-option' } })
    expect(control.permissionAnswers).toEqual([])
    expect(process.answer(request.id, 'yes').ok).toBe(true)
    expect(process.answer(request.id, 'yes')).toMatchObject({ ok: false, error: { code: 'unknown-request' } })
    await turn
    expect(control.permissionAnswers).toHaveLength(1)
  })

  it('reads the kind, the title and the locations from the tool call that came before, when the request names only the ID', async () => {
    const listened = listen()
    const process = start({}, listened)
    await process.ready
    const internals = process as unknown as {
      remember(update: unknown): void
      askPermission(params: unknown, signal: AbortSignal): Promise<unknown>
    }
    internals.remember({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'npm test', kind: 'execute', locations: [{ path: 'C:\\work\\a.txt' }], status: 'pending' })
    internals.remember({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'in_progress' })
    const options = [{ optionId: 'yes', name: 'Yes', kind: 'allow_once' }]
    const first = internals.askPermission({ sessionId: 's1', toolCall: { toolCallId: 't1', rawInput: {} }, options }, new AbortController().signal)
    // The request of the adapter has its own fields, which win over the remembered ones.
    const second = internals.askPermission({ sessionId: 's1', toolCall: { toolCallId: 't1', title: 'Other title', kind: 'read' }, options }, new AbortController().signal)
    // A call that nobody announced: the card falls back to the defaults of the window.
    const third = internals.askPermission({ sessionId: 's1', toolCall: { toolCallId: 'unknown' }, options }, new AbortController().signal)
    expect(listened.permissions.map(({ toolId, title, toolKind, locations }) => ({ toolId, title, toolKind, locations }))).toEqual([
      { toolId: 't1', title: 'npm test', toolKind: 'execute', locations: ['C:\\work\\a.txt'] },
      { toolId: 't1', title: 'Other title', toolKind: 'read', locations: ['C:\\work\\a.txt'] },
      { toolId: 'unknown', title: null, toolKind: null, locations: [] }
    ])
    for (const request of listened.permissions) process.answer(request.id, 'yes')
    await Promise.all([first, second, third])
  })

  it('gives a request with no option the option "Cancel request", which answers cancelled', async () => {
    await control.scenario('steps', { prompt: [{ do: 'ask', requests: [{ id: 'a', title: 'Odd tool', kind: 'other', options: [] }] }, { do: 'answers' }] })
    const listened = listen()
    const process = start({}, listened)
    await process.ready
    const turn = process.prompt('Run it')
    const request = await waitFor(() => listened.permissions[0], 'the request')
    expect(request.options).toEqual([{ id: 'aether-cancel-request', label: 'Cancel request', kind: 'refuse-once', cancel: true }])
    expect(process.answer(request.id, 'aether-cancel-request').ok).toBe(true)
    expect(await control.waitForPermission('a')).toEqual({ id: 'a', outcome: { outcome: 'cancelled' } })
    await turn
  })

  it('sends the cancel, then answers cancelled to each open request that the agent did not withdraw, and reports nothing', async () => {
    await control.scenario('steps', { prompt: [{ do: 'ask', withdrawOnCancel: true, requests: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] }, { do: 'answers' }] })
    const listened = listen()
    const process = start({}, listened)
    await process.ready
    const turn = process.prompt('Run it')
    await waitFor(() => (listened.permissions.length === 2 ? true : undefined), 'two requests')
    await process.cancel()
    expect(await control.waitForPermission('a')).toEqual({ id: 'a', outcome: { outcome: 'cancelled' } })
    expect(await control.waitForPermission('b')).toEqual({ id: 'b', outcome: { outcome: 'cancelled' } })
    // The turn ends by the cancel, or by the answers when they came first. Both are normal.
    expect(await turn).toMatchObject({ ok: true })
    // The agent withdrew the requests on the cancel (withdrawOnCancel), and each of them still got exactly one answer.
    expect(control.permissionAnswers.map((answer) => answer.outcome)).toEqual([{ outcome: 'cancelled' }, { outcome: 'cancelled' }])
    expect(listened.closed).toEqual([])
    expect(process.answer(listened.permissions[0]!.id, 'yes')).toMatchObject({ ok: false, error: { code: 'unknown-request' } })
  })

  it('reports a request that the agent withdrew, and answers it with cancelled', async () => {
    await control.scenario('steps', { prompt: [...ASK_ONE, { do: 'gate', name: 'withdraw' }, { do: 'withdraw', id: 'run-tests' }, { do: 'gate', name: 'end' }] })
    const listened = listen()
    const process = start({}, listened)
    await process.ready
    const turn = process.prompt('Run it')
    const request = await waitFor(() => listened.permissions[0], 'the request')
    await control.waitForGate('withdraw')
    await control.open('withdraw')
    await waitFor(() => (listened.closed.length === 1 ? true : undefined), 'the withdraw')
    expect(listened.closed).toEqual([['permission', request.id, 'withdrawn']])
    expect(await control.waitForPermission('run-tests')).toEqual({ id: 'run-tests', outcome: { outcome: 'cancelled' } })
    expect(process.answer(request.id, 'yes')).toMatchObject({ ok: false, error: { code: 'unknown-request' } })
    await control.waitForGate('end')
    await process.close()
    await turn
  })

  it('reports each open request as exited when the process ends by itself, and before it reports the exit', async () => {
    await control.scenario('steps', { prompt: [{ do: 'ask', requests: [{ id: 'a', title: 'A' }] }, { do: 'elicit', id: 'f', request: { mode: 'form', message: 'm', requestedSchema: { type: 'object', properties: { x: { type: 'string' } } } } }, { do: 'gate', name: 'never' }] })
    const order: string[] = []
    const listened = listen()
    const inner = listened.listener
    listened.listener = {
      ...inner,
      permissionClosed: (id, reason) => {
        order.push(`permission ${reason}`)
        inner.permissionClosed(id, reason)
      },
      elicitationClosed: (id, reason) => {
        order.push(`elicitation ${reason}`)
        inner.elicitationClosed(id, reason)
      },
      exited: (info) => {
        order.push('exited')
        inner.exited(info)
      }
    }
    const process = start({}, listened)
    await process.ready
    const turn = process.prompt('Run it')
    await waitFor(() => (listened.permissions.length === 1 && listened.elicitations.length === 1 ? true : undefined), 'both requests')
    globalThis.process.kill(control.pids[0]!)
    expect((await turn).ok).toBe(false)
    expect(order).toEqual(['permission exited', 'elicitation exited', 'exited'])
  })

  it('reports nothing when the caller closes the process, and the agent gets cancelled for each open request', async () => {
    await control.scenario('steps', { prompt: [...ASK_ONE, { do: 'answers' }] })
    const listened = listen()
    const process = start({}, listened)
    await process.ready
    const turn = process.prompt('Run it')
    await waitFor(() => listened.permissions[0], 'the request')
    await process.close()
    await turn
    expect(await control.waitForPermission('run-tests')).toEqual({ id: 'run-tests', outcome: { outcome: 'cancelled' } })
    expect(listened.closed).toEqual([])
    // A request after the close gets cancelled at once and opens no card.
    const internals = process as unknown as { askPermission(params: unknown, signal: AbortSignal): Promise<unknown> }
    expect(await internals.askPermission({ sessionId: 's1', toolCall: { toolCallId: 'late' }, options: [] }, new AbortController().signal)).toEqual({ outcome: { outcome: 'cancelled' } })
    expect(listened.permissions).toHaveLength(1)
  })
})

describe('AcpAgents, forms of the agent', () => {
  const QUESTION = {
    toolCallId: 'ask-1',
    message: 'Which test runner do you want?',
    requestedSchema: {
      type: 'object',
      properties: {
        question_0: {
          type: 'string',
          title: 'Runner',
          oneOf: [
            { const: 'Vitest', title: 'Vitest (Recommended)', description: 'Fast.' },
            { const: 'Jest', title: 'Jest', description: 'Widely used.' }
          ]
        },
        question_0_custom: { type: 'string', title: 'Other', description: 'Type your own answer.' }
      }
    }
  }
  const FALLBACK = {
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
  const waitFor = async <T>(read: () => T | undefined, what: string): Promise<T> => {
    for (let wait = 0; wait < 400; wait += 1) {
      const value = read()
      if (value !== undefined) return value
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(`Timeout: ${what}`)
  }

  it('shows a question of AskUserQuestion: fields in the order of the agent, the text linked to its question, and the text kept', async () => {
    await control.scenario('steps', { prompt: [{ do: 'elicit', id: 'q', request: { mode: 'form', ...QUESTION } }, { do: 'answers' }] })
    const listened = listen()
    const process = start({}, listened)
    await process.ready
    const turn = process.prompt('Set up the tests')
    const form = await waitFor(() => listened.elicitations[0], 'the form')
    expect(form).toMatchObject({ toolId: 'ask-1', message: 'Which test runner do you want?', recommended: null, keepsText: true })
    expect(form.fields).toEqual([
      {
        key: 'question_0',
        kind: 'choice',
        title: 'Runner',
        description: null,
        options: [
          { value: 'Vitest', label: 'Vitest (Recommended)', description: 'Fast.' },
          { value: 'Jest', label: 'Jest', description: 'Widely used.' }
        ]
      },
      { key: 'question_0_custom', kind: 'text', title: 'Other', description: 'Type your own answer.', completes: 'question_0' }
    ])
    expect(process.answerElicitation(form.id, { action: 'submit', values: { question_0: 'Mocha' } })).toMatchObject({ ok: false, error: { code: 'invalid-answer' } })
    expect(process.answerElicitation('nope', { action: 'skip' })).toMatchObject({ ok: false, error: { code: 'unknown-request' } })
    expect(control.elicitationAnswers).toEqual([])
    expect(process.answerElicitation(form.id, { action: 'submit', values: { question_0: 'Jest', question_0_custom: 'for e2e' } }).ok).toBe(true)
    expect(await control.waitForElicitation('q')).toEqual({ id: 'q', response: { action: 'accept', content: { question_0: 'Jest', question_0_custom: 'for e2e' } } })
    await turn
  })

  it('sends decline for a skip and cancel for a cancel of the process', async () => {
    await control.scenario('steps', {
      prompt: [{ do: 'elicit', id: 'one', request: { mode: 'form', ...QUESTION } }, { do: 'answers' }, { do: 'elicit', id: 'two', request: { mode: 'form', ...QUESTION } }, { do: 'answers' }]
    })
    const listened = listen()
    const process = start({}, listened)
    await process.ready
    const turn = process.prompt('Set up the tests')
    const first = await waitFor(() => listened.elicitations[0], 'the first form')
    expect(process.answerElicitation(first.id, { action: 'skip' }).ok).toBe(true)
    expect(await control.waitForElicitation('one')).toEqual({ id: 'one', response: { action: 'decline' } })
    await waitFor(() => listened.elicitations[1], 'the second form')
    await process.cancel()
    expect(await control.waitForElicitation('two')).toEqual({ id: 'two', response: { action: 'cancel' } })
    expect(listened.closed).toEqual([])
    await turn
  })

  it('answers -32602 for a form with a field that Aether does not render, and for a form with no field, and opens no card', async () => {
    const number = { mode: 'form', message: 'How many workers?', requestedSchema: { type: 'object', properties: { workers: { type: 'number', title: 'Workers' } } } }
    const empty = { mode: 'form', message: 'Nothing to ask.', requestedSchema: { type: 'object', properties: {} } }
    await control.scenario('steps', { prompt: [{ do: 'elicit', id: 'n', request: number }, { do: 'elicit', id: 'e', request: empty }, { do: 'answers' }] })
    const listened = listen()
    const process = start({}, listened)
    await process.ready
    await process.prompt('Go')
    expect((await control.waitForElicitation('n')).error?.code).toBe(-32602)
    expect((await control.waitForElicitation('e')).error?.code).toBe(-32602)
    expect(listened.elicitations).toEqual([])
  })

  it('puts the recommended option of the refusal fallback first, and keeps the order of the agent for the rest', async () => {
    await control.scenario('steps', { prompt: [{ do: 'elicit', id: 'f', request: { mode: 'form', ...FALLBACK } }, { do: 'answers' }] })
    const listened = listen()
    const process = start({}, listened)
    await process.ready
    const turn = process.prompt('Review it')
    const form = await waitFor(() => listened.elicitations[0], 'the form')
    expect(form.recommended).toBe('cancelled')
    expect(form.fields[0]).toMatchObject({ kind: 'choice', options: [{ value: 'cancelled' }, { value: 'retry_fallback' }] })
    expect(process.answerElicitation(form.id, { action: 'skip' }).ok).toBe(true)
    await turn
  })

  it('keeps no typed text of a form of an MCP server, which has no tool call', async () => {
    const token = { mode: 'form', message: 'The example service needs a token.', requestedSchema: { type: 'object', properties: { token: { type: 'string', title: 'Token' } } } }
    await control.scenario('steps', { prompt: [{ do: 'elicit', id: 't', request: token }, { do: 'answers' }] })
    const listened = listen()
    const process = start({}, listened)
    await process.ready
    const turn = process.prompt('Connect')
    const form = await waitFor(() => listened.elicitations[0], 'the form')
    expect(form).toMatchObject({ toolId: null, keepsText: false, recommended: null })
    expect(process.answerElicitation(form.id, { action: 'skip' }).ok).toBe(true)
    await turn
  })

  it('reports the model only when the agent reports another model after the start', async () => {
    await control.scenario('steps', { prompt: [{ do: 'elicit', id: 'f', request: { mode: 'form', ...FALLBACK }, fallbackModel: 'claude-opus-5-5' }, { do: 'answers' }] })
    const listened = listen()
    const process = start({ model: 'claude-fable-5-2' }, listened)
    await process.ready
    // The start sets the model through a request, so it reports nothing.
    expect(listened.updates.filter((update) => update.type === 'model')).toEqual([])
    const turn = process.prompt('Review it')
    const form = await waitFor(() => listened.elicitations[0], 'the form')
    expect(process.answerElicitation(form.id, { action: 'submit', values: { choice: 'retry_fallback' } }).ok).toBe(true)
    await turn
    await waitFor(() => (listened.updates.some((update) => update.type === 'model') ? true : undefined), 'the model update')
    expect(listened.updates.filter((update) => update.type === 'model')).toEqual([{ type: 'model', model: 'claude-opus-5-5' }])
  })
})

describe('AcpAgents, a request while cancel runs outside a turn', () => {
  it('answers cancelled at once and opens no card, for a request and for a form, while a cancel with no turn is sent', async () => {
    const listened = listen()
    const process = start({}, listened)
    await process.ready
    const internals = process as unknown as {
      askPermission(params: unknown, signal: AbortSignal): Promise<unknown>
      askElicitation(params: unknown, signal: AbortSignal): Promise<unknown>
    }
    // No prompt runs: the cancel is Stop with no turn. The calls below come while `cancel` is still sending.
    const cancelling = process.cancel()
    const permission = internals.askPermission({ sessionId: 's1', toolCall: { toolCallId: 'late' }, options: [{ optionId: 'yes', name: 'Yes', kind: 'allow_once' }] }, new AbortController().signal)
    const form = internals.askElicitation(
      { mode: 'form', message: 'm', requestedSchema: { type: 'object', properties: { x: { type: 'string' } } } },
      new AbortController().signal
    )
    expect(await permission).toEqual({ outcome: { outcome: 'cancelled' } })
    expect(await form).toEqual({ action: 'cancel' })
    await cancelling
    expect(listened.permissions).toEqual([])
    expect(listened.elicitations).toEqual([])
    // After the cancel ended, a new request opens a card again.
    void internals.askPermission({ sessionId: 's1', toolCall: { toolCallId: 'next' }, options: [{ optionId: 'yes', name: 'Yes', kind: 'allow_once' }] }, new AbortController().signal)
    expect(listened.permissions.map((request) => request.toolId)).toEqual(['next'])
  })
})
