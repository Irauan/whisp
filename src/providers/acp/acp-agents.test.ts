import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ControlServer } from '../../../tests/simulated-agent/control'
import { err, ok } from '../../building-blocks/result'
import type { AgentListener, AgentProcess, AgentStartInput, AgentUpdate } from '../../building-blocks/agent.port'
import { claudeCodeRecipe } from '../claude-code/claude-code'
import { AcpAgents, translateUpdate } from './acp-agents'

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

const agents = () => new AcpAgents({ recipe: claudeCodeRecipe({ override: async () => ok(control.agent) }), environment: () => aether, closeLimitMs: 2000 })

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
  listener: AgentListener
}

function listen(): Listened {
  const updates: AgentUpdate[] = []
  const exits: Listened['exits'] = []
  return { updates, exits, listener: { update: (update) => updates.push(update), exited: (info) => exits.push(info) } }
}

function start(part: Partial<AgentStartInput> = {}, listened: Listened = listen()): AgentProcess {
  const process = agents().start(input(part), listened.listener)
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
  })

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

  it('answers a permission request with "cancelled" until the permission queue exists', async () => {
    await control.scenario('tool', { title: 'Edit README.md' })
    const listened = listen()
    const process = start({}, listened)
    await process.ready
    await process.prompt('go')
    // The simulated agent says "Skipped" when the client did not allow the tool.
    expect(listened.updates.filter((update) => update.type === 'text')).toEqual([{ type: 'text', text: 'Skipped' }])
  })
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

  it('gives an unknown tool status as null in an update, and as pending in a new call', () => {
    expect(translateUpdate({ sessionUpdate: 'tool_call_update', toolCallId: 'a', status: 'weird' as never })).toMatchObject({ status: null })
    expect(translateUpdate({ sessionUpdate: 'tool_call', toolCallId: 'a', title: 't', status: 'weird' as never })).toMatchObject({ status: 'pending' })
  })
})
