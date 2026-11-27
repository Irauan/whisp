import { describe, expect, it } from 'vitest'
import type {
  AgentListener,
  AgentPort,
  AgentProcess,
  AgentStartInput,
  AgentUpdate,
  PromptErrorCode,
  StartErrorCode,
  Started,
  StopReason
} from '../../../building-blocks/agent.port'
import { AccountsInStart } from '../../../building-blocks/accounts-in-start'
import { openDatabase } from '../../../building-blocks/database'
import type { GithubTokenPort } from '../../../building-blocks/github.port'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { err, ok, type Result } from '../../../building-blocks/result'
import type { SessionEvent } from '../entry'
import { Processes } from '../processes.store'
import { SessionStore } from '../session.store'
import { Transcript } from '../transcript.store'
import { sendMessage } from './send-message.contract'
import { sendMessageHandler, type SendMessageDeps, type StartGuard, type StartRequest } from './send-message.handler'

/** One deferred value, so that a test decides when an agent answers. */
function deferred<Value>() {
  let resolve: (value: Value) => void = () => undefined
  const promise = new Promise<Value>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

class FakeProcess implements AgentProcess {
  readonly start = deferred<Result<Started, StartErrorCode>>()
  readonly prompts: string[] = []
  readonly turn = deferred<Result<StopReason, PromptErrorCode>>()
  cancels = 0
  closed = 0
  ready = this.start.promise

  constructor(
    readonly input: AgentStartInput,
    readonly listener: AgentListener
  ) {}

  /** The process is ready, with this agent session. */
  becomeReady(agentSessionId: string, part: Partial<Started> = {}): void {
    this.start.resolve(ok({ agentSessionId, resumed: false, resumeError: null, ...part }))
  }

  say(update: AgentUpdate): void {
    this.listener.update(update)
  }

  prompt(text: string): Promise<Result<StopReason, PromptErrorCode>> {
    this.prompts.push(text)
    return this.turn.promise
  }

  cancel(): Promise<void> {
    this.cancels += 1
    if (this.cancels === 1) {
      // Before `ready` a cancel ends the start. After it, a cancel ends the turn.
      this.start.resolve(err('cancelled', 'The start was cancelled.'))
      this.turn.resolve(ok('cancelled'))
    }
    return Promise.resolve()
  }

  close(): Promise<void> {
    this.closed += 1
    return Promise.resolve()
  }
}

/** A port whose processes a test controls. Each `start` makes one process. */
class FakeAgents implements AgentPort {
  readonly processes: FakeProcess[] = []
  failWith: Error | null = null

  start(input: AgentStartInput, listener: AgentListener): AgentProcess {
    if (this.failWith) throw this.failWith
    const process = new FakeProcess(input, listener)
    this.processes.push(process)
    return process
  }
}

function setup(
  options: { login?: string | null; token?: Result<string, 'github-cli-missing' | 'github-token-missing'>; guard?: StartGuard } = {}
) {
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  const { database } = opened.value
  const login = options.login === undefined ? 'example-user' : options.login
  database.prepare('INSERT INTO profiles (id, name, github_login, created_at) VALUES (?, ?, ?, ?)').run('p1', 'Personal', login, '2026-01-01')
  const insert = database.prepare(
    "INSERT INTO sessions (id, profile_id, title, prompt, mode, source_path, model, created_at) VALUES (?, 'p1', 't', 'p', ?, ?, ?, '2026-01-01')"
  )
  insert.run('s1', 'plan', process.cwd(), 'claude-opus-5-5')
  insert.run('s2', 'ask', process.cwd(), 'default')
  insert.run('gone', 'ask', 'C:\\this-folder-does-not-exist-aether', 'default')
  const store = new SessionStore(database)
  const events: SessionEvent[] = []
  let count = 0
  const ids = { next: () => `id${++count}` }
  const clock = { now: () => new Date('2026-01-02T00:00:00.000Z') }
  const transcript = new Transcript(store, (event) => events.push(event), clock, ids)
  const agents = new FakeAgents()
  const processes = new Processes()
  const starting = new AccountsInStart()
  const logged: string[] = []
  const tokens: string[] = []
  const requests: StartRequest[] = []
  const guard: StartGuard =
    options.guard ??
    ((request) => {
      requests.push(request)
      return Promise.resolve(ok({}))
    })
  const github: GithubTokenPort = {
    tokenOf: (name) => {
      tokens.push(name)
      return Promise.resolve(options.token ?? ok(`fake-token-of-${name}`))
    }
  }
  const deps: SendMessageDeps = {
    store,
    transcript,
    processes,
    agents,
    github,
    starting,
    guard,
    // The slice `record-agent-update` does this in the app. A slice never imports another slice, so the test
    // connects the two kinds of update that it needs by hand.
    record: (sessionId, update) => {
      if (update.type === 'text') transcript.addText(sessionId, 'agent', update.text)
      else if (update.type === 'tool') transcript.announceTool(sessionId, update)
    },
    clock,
    ids,
    log: (message, cause) => logged.push(`${message} ${String(cause)}`)
  }
  const send = (id: string, text: string) => sendMessageHandler(deps, { id, text })
  /** Lets the turn run until the agent process exists. The process then waits for the test. */
  const processOf = async (index: number): Promise<FakeProcess> => {
    for (let wait = 0; wait < 50 && !agents.processes[index]; wait += 1) await Promise.resolve()
    const found = agents.processes[index]
    if (!found) throw new Error(`The agent process ${index} does not exist.`)
    return found
  }
  return { database, store, transcript, processes, agents, events, logged, tokens, requests, starting, deps, send, processOf }
}

const entriesOf = (store: SessionStore, id = 's1') => store.entriesOf(id).map((view) => view.entry)

describe('sessions.send-message', () => {
  it('accepts the message at once, shows the state Starting, and saves the message of the user', async () => {
    const { store, transcript, send, processOf } = setup()
    const { result, finished } = send('s1', 'Say hello')
    expect(result).toEqual({ ok: true, value: {} })
    expect(sendMessage.output.safeParse(result).success).toBe(true)
    expect(transcript.statusOf('s1')).toBe('starting')
    expect(entriesOf(store)).toEqual([{ kind: 'user', text: 'Say hello' }])
    const agent = await processOf(0)
    agent.becomeReady('a1')
    agent.say({ type: 'text', text: 'Hello ' })
    agent.turn.resolve(ok('end_turn'))
    await finished
    expect(transcript.statusOf('s1')).toBe('idle')
  })

  it('streams the reply and saves it as one entry (A1)', async () => {
    const { store, events, send, processOf } = setup()
    const { finished } = send('s1', 'Say hello')
    const agent = await processOf(0)
    agent.becomeReady('a1')
    await agent.ready
    agent.say({ type: 'text', text: 'Hello ' })
    agent.say({ type: 'text', text: 'from the agent.' })
    agent.turn.resolve(ok('end_turn'))
    await finished
    expect(entriesOf(store)).toEqual([
      { kind: 'user', text: 'Say hello' },
      { kind: 'agent', text: 'Hello from the agent.' }
    ])
    expect(events.map((event) => event.change)).toContainEqual({ type: 'status', status: 'working' })
    expect(events.at(-1)?.change).toEqual({ type: 'status', status: 'idle' })
  })

  it('starts the agent from the saved session: folder, mode and model of the row, with no resume and no additional folder', async () => {
    const { send, processOf } = setup()
    send('s1', 'Say hello')
    const agent = await processOf(0)
    expect(agent.input).toEqual({
      mainDirectory: process.cwd(),
      additionalDirectories: [],
      model: 'claude-opus-5-5',
      mode: 'plan',
      sharedItems: [],
      settings: {},
      environment: { GH_TOKEN: 'fake-token-of-example-user' },
      resume: null
    })
  })

  it('gives the agent the token of the GitHub account of the profile, and never saves the token (A16)', async () => {
    const { store, database, tokens, send, processOf } = setup({ login: 'example-user-two' })
    const { finished } = send('s1', 'Say hello')
    const agent = await processOf(0)
    agent.becomeReady('a1')
    agent.turn.resolve(ok('end_turn'))
    await finished
    expect(tokens).toEqual(['example-user-two'])
    expect(agent.input.environment).toEqual({ GH_TOKEN: 'fake-token-of-example-user-two' })
    const rows = JSON.stringify([
      ...database.prepare('SELECT * FROM entries').all(),
      ...database.prepare('SELECT * FROM sessions').all(),
      ...database.prepare('SELECT * FROM providers').all()
    ])
    expect(rows).not.toContain('fake-token-of')
    expect(entriesOf(store).some((entry) => 'text' in entry && entry.text.includes('fake-token'))).toBe(false)
  })

  it('sets no GH_TOKEN for a profile without a GitHub account, and asks for no token', async () => {
    const { tokens, send, processOf } = setup({ login: null })
    send('s1', 'Say hello')
    const agent = await processOf(0)
    expect(agent.input.environment).toEqual({})
    expect(tokens).toEqual([])
  })

  it('starts without the token and says so when gh has no token for the account', async () => {
    const { store, send, processOf } = setup({ token: err('github-token-missing', 'No token.') })
    const { finished } = send('s1', 'Say hello')
    const agent = await processOf(0)
    expect(agent.input.environment).toEqual({})
    agent.becomeReady('a1')
    agent.turn.resolve(ok('end_turn'))
    await finished
    expect(entriesOf(store)).toContainEqual(expect.objectContaining({ kind: 'notice', code: 'github-token' }))
  })

  it('creates the current account of the profile at the first start when it has none, and saves the agent run when the agent session exists (decision 0014)', async () => {
    const { database, store, send, processOf } = setup()
    expect(database.prepare('SELECT count(*) AS total FROM providers').get()).toMatchObject({ total: 0 })
    const { finished } = send('s1', 'Say hello')
    const agent = await processOf(0)
    // Before the agent session exists, no agent run is saved.
    expect(store.agentRunOf('s1')).toBeNull()
    agent.becomeReady('a1')
    agent.turn.resolve(ok('end_turn'))
    await finished
    const provider = database.prepare('SELECT id, kind, label, settings, is_current FROM providers').all()
    expect(provider).toEqual([{ id: expect.any(String), kind: 'claude-code', label: 'Claude', settings: '{}', is_current: 1 }])
    expect(store.agentRunOf('s1')).toEqual({ id: expect.any(String), providerId: provider[0]?.id, settings: {}, externalId: 'a1' })
    expect(store.find('s1')?.providerId).toBe(provider[0]?.id)
  })

  it('saves no agent run after a failed first start, so the user can fix the profile and try again', async () => {
    const { store, send, processOf } = setup()
    const { finished } = send('s1', 'Say hello')
    const agent = await processOf(0)
    agent.start.resolve(err('not-signed-in', 'Claude Code is not signed in. Open a terminal.'))
    await finished
    expect(store.agentRunOf('s1')).toBeNull()
  })

  it('starts a session with the current account of its profile, and resumes with the account of its run, also after the current account changed (decision 0014)', async () => {
    const { database, store, processes, send, processOf } = setup()
    const insert = database.prepare(
      "INSERT INTO providers (id, profile_id, kind, label, settings, is_current, created_at) VALUES (?, 'p1', 'claude-code', 'Claude', ?, ?, ?)"
    )
    insert.run('v1', '{"configFolder":"C:/f1"}', 1, '2026-01-01')
    const first = send('s1', 'Say hello')
    const one = await processOf(0)
    expect(one.input.settings).toEqual({ configFolder: 'C:/f1' })
    expect(one.input.resume).toBeNull()
    one.becomeReady('a1')
    one.turn.resolve(ok('end_turn'))
    await first.finished
    expect(store.agentRunOf('s1')).toMatchObject({ providerId: 'v1', externalId: 'a1' })

    // The profile gets a new current account, as the edit of the Claude folder does. The process ends.
    // The next message of the old session resumes with the account of its run.
    database.prepare('UPDATE providers SET is_current = 0 WHERE id = ?').run('v1')
    insert.run('v2', '{"configFolder":"C:/f2"}', 1, '2026-01-02')
    one.listener.exited({ code: 0, logTail: '' })
    expect(processes.get('s1')).toBeUndefined()
    send('s1', 'Are you still there?')
    const two = await processOf(1)
    expect(two.input.settings).toEqual({ configFolder: 'C:/f1' })
    expect(two.input.resume).toBe('a1')

    // A session that starts now starts with the new current account.
    send('s2', 'Start fresh')
    const three = await processOf(2)
    expect(three.input.settings).toEqual({ configFolder: 'C:/f2' })
    expect(three.input.resume).toBeNull()
  })

  it('gives a session without an account the current account of its profile at the first start', async () => {
    const { database, store, send, processOf } = setup()
    database
      .prepare("INSERT INTO providers (id, profile_id, kind, label, settings, is_current, created_at) VALUES ('v1', 'p1', 'claude-code', 'Claude', '{\"profileName\":\"work\"}', 1, '2026-01-01')")
      .run()
    expect(store.find('s1')?.providerId).toBeNull()
    const { finished } = send('s1', 'Say hello')
    const agent = await processOf(0)
    expect(agent.input.settings).toEqual({ profileName: 'work' })
    agent.becomeReady('a1')
    agent.turn.resolve(ok('end_turn'))
    await finished
    expect(store.find('s1')?.providerId).toBe('v1')
    expect(database.prepare('SELECT count(*) AS total FROM providers').get()).toMatchObject({ total: 1 })
  })

  it('uses the account that the user fixed when the first start failed: the retry reads the current account again (decision 0014)', async () => {
    const { database, store, send, processOf } = setup()
    database
      .prepare("INSERT INTO providers (id, profile_id, kind, label, settings, is_current, created_at) VALUES ('v1', 'p1', 'claude-code', 'Claude', '{\"configFolder\":\"C:/f1\"}', 1, '2026-01-01')")
      .run()
    const failing = send('s1', 'Say hello')
    const one = await processOf(0)
    expect(one.input.settings).toEqual({ configFolder: 'C:/f1' })
    one.start.resolve(err('not-signed-in', 'Claude Code is not signed in. Open a terminal.'))
    await failing.finished
    expect(store.agentRunOf('s1')).toBeNull()

    // No run used the account, so the edit of the profile changes it in place.
    database.prepare(`UPDATE providers SET settings = '{"configFolder":"C:/f2"}' WHERE id = 'v1'`).run()
    const retry = send('s1', 'Say hello again')
    const two = await processOf(1)
    expect(two.input.settings).toEqual({ configFolder: 'C:/f2' })
    two.becomeReady('a1')
    two.turn.resolve(ok('end_turn'))
    await retry.finished
    expect(store.agentRunOf('s1')).toMatchObject({ providerId: 'v1', settings: { configFolder: 'C:/f2' } })
  })

  it('holds the account of a first start in `starting` from the choice of the account until the start ends, also when the start fails', async () => {
    const { database, starting, send, processOf } = setup()
    const held = async (providerId: string) => {
      for (let wait = 0; wait < 50 && !starting.has(providerId); wait += 1) await Promise.resolve()
      expect(starting.has(providerId)).toBe(true)
    }
    database
      .prepare("INSERT INTO providers (id, profile_id, kind, label, settings, is_current, created_at) VALUES ('v1', 'p1', 'claude-code', 'Claude', '{}', 1, '2026-01-01')")
      .run()
    const first = send('s1', 'Say hello')
    // The gate answers first, so that no account is read before the answer. The account is then read and
    // held in one step, with no wait between, so no edit can come between.
    await held('v1')
    const one = await processOf(0)
    expect(starting.has('v1')).toBe(true)
    one.becomeReady('a1')
    one.turn.resolve(ok('end_turn'))
    await first.finished
    expect(starting.has('v1')).toBe(false)

    const failing = send('s2', 'Start fresh')
    await held('v1')
    const two = await processOf(1)
    two.start.resolve(err('failed', 'Claude Code did not start.'))
    await failing.finished
    expect(starting.has('v1')).toBe(false)
  })

  it('does not hold the account for a resume: the run names it', async () => {
    const { database, starting, processes, send, processOf } = setup()
    const first = send('s1', 'Say hello')
    const one = await processOf(0)
    one.becomeReady('a1')
    one.turn.resolve(ok('end_turn'))
    await first.finished
    one.listener.exited({ code: 0, logTail: '' })
    expect(processes.get('s1')).toBeUndefined()
    const providerId = String(database.prepare('SELECT id FROM providers').get()?.id)
    const again = send('s1', 'Are you still there?')
    expect(starting.has(providerId)).toBe(false)
    const two = await processOf(1)
    two.becomeReady('a1', { resumed: true })
    two.turn.resolve(ok('end_turn'))
    await again.finished
  })

  it('sends the next message to the same process and the same agent session (A2)', async () => {
    const { agents, store, send, processOf } = setup()
    const first = send('s1', 'Say hello')
    const agent = await processOf(0)
    agent.becomeReady('a1')
    agent.turn.resolve(ok('end_turn'))
    await first.finished

    const second = send('s1', 'Say it again')
    expect(second.result.ok).toBe(true)
    await second.finished
    expect(agents.processes).toHaveLength(1)
    expect(agent.prompts).toEqual(['Say hello', 'Say it again'])
    expect(entriesOf(store).filter((entry) => entry.kind === 'user').map((entry) => entry.text)).toEqual(['Say hello', 'Say it again'])
  })

  it('gives each session its own process, also when both send before either process is ready (A7)', async () => {
    const { agents, processes, send, processOf } = setup()
    const first = send('s1', 'Fix the login page')
    const second = send('s2', 'Write the release notes')
    expect(first.result.ok && second.result.ok).toBe(true)
    const one = await processOf(0)
    const two = await processOf(1)
    expect(agents.processes).toHaveLength(2)
    expect(one.input.mainDirectory).toBe(process.cwd())
    expect(processes.get('s1')).toBe(one)
    expect(processes.get('s2')).toBe(two)
    two.becomeReady('a2')
    one.becomeReady('a1')
    one.turn.resolve(ok('end_turn'))
    two.turn.resolve(ok('end_turn'))
    await Promise.all([first.finished, second.finished])
    expect(one.prompts).toEqual(['Fix the login page'])
    expect(two.prompts).toEqual(['Write the release notes'])
  })

  it('refuses a message while a turn runs, and a session that does not exist, and a folder that is gone', () => {
    const { store, transcript, send } = setup()
    send('s1', 'Say hello')
    expect(send('s1', 'Again')).toMatchObject({ result: { ok: false, error: { code: 'turn-active' } } })
    expect(entriesOf(store)).toEqual([{ kind: 'user', text: 'Say hello' }])
    expect(send('missing', 'Hi').result).toMatchObject({ ok: false, error: { code: 'unknown-session' } })
    const gone = send('gone', 'Hi')
    expect(gone.result).toMatchObject({ ok: false, error: { code: 'invalid-folder' } })
    expect(sendMessage.output.safeParse(gone.result).success).toBe(true)
    // Nothing changed for the session whose folder is gone.
    expect(transcript.statusOf('gone')).toBe('idle')
    expect(store.entryCount('gone')).toBe(0)
  })

  it('stops a turn: "Stopped.", the open tool call fails, and the composer is ready (A3)', async () => {
    const { store, transcript, processes, send, processOf } = setup()
    const { finished } = send('s1', 'Write a long answer')
    const agent = await processOf(0)
    agent.becomeReady('a1')
    await agent.ready
    await Promise.resolve()
    agent.say({ type: 'text', text: 'This is the first part.' })
    agent.say({ type: 'tool', id: 'run-tests', title: 'Run the test suite', toolKind: 'execute', status: 'in_progress' })
    const turn = processes.turnOf('s1')
    expect(turn).toBeDefined()
    // What the slice `stop` does.
    if (turn) turn.stopped = true
    await agent.cancel()
    await finished
    expect(entriesOf(store)).toEqual([
      { kind: 'user', text: 'Write a long answer' },
      { kind: 'agent', text: 'This is the first part.' },
      { kind: 'tool', toolId: 'run-tests', title: 'Run the test suite', toolKind: 'execute', status: 'failed' },
      { kind: 'notice', tone: 'info', text: 'Stopped.', code: 'stopped' }
    ])
    expect(transcript.statusOf('s1')).toBe('idle')
    expect(processes.turnOf('s1')).toBeUndefined()
  })

  it('stops a start that is not ready: the process is cancelled, "Stopped." shows, and the session is idle', async () => {
    const { store, transcript, processes, send, processOf } = setup()
    const { finished } = send('s1', 'Say hello')
    const agent = await processOf(0)
    const turn = processes.turnOf('s1')
    if (turn) turn.stopped = true
    await agent.cancel()
    await finished
    expect(entriesOf(store)).toEqual([
      { kind: 'user', text: 'Say hello' },
      { kind: 'notice', tone: 'info', text: 'Stopped.', code: 'stopped' }
    ])
    expect(processes.get('s1')).toBeUndefined()
    expect(transcript.statusOf('s1')).toBe('idle')
    // The session did not start, so it has no agent run.
    expect(store.agentRunOf('s1')).toBeNull()
  })

  it('does not start a process when the user stops before the GitHub token arrives', async () => {
    const { agents, store, processes, send } = setup()
    const { finished } = send('s1', 'Say hello')
    const turn = processes.turnOf('s1')
    if (turn) turn.stopped = true
    await finished
    expect(agents.processes).toHaveLength(0)
    expect(entriesOf(store).at(-1)).toMatchObject({ kind: 'notice', text: 'Stopped.' })
  })

  it.each(['failed', 'not-signed-in'] as const)(
    'closes the live process when Stop is followed by the error "%s", so the next message starts one process and the first one does not stay',
    async (code) => {
      const { store, transcript, processes, agents, send, processOf } = setup()
      const { finished } = send('s1', 'Write a long answer')
      const one = await processOf(0)
      one.becomeReady('a1')
      await one.ready
      await Promise.resolve()
      // What the slice `stop` does: it marks the turn and sends a cancel. The process stays alive.
      const turn = processes.turnOf('s1')
      if (turn) turn.stopped = true
      one.turn.resolve(err(code, 'The agent answered the cancel with an error.'))
      await finished
      expect(one.closed).toBe(1)
      expect(processes.get('s1')).toBeUndefined()
      expect(entriesOf(store).at(-1)).toEqual({ kind: 'notice', tone: 'info', text: 'Stopped.', code: 'stopped' })
      expect(transcript.statusOf('s1')).toBe('idle')

      const next = send('s1', 'Again')
      const two = await processOf(1)
      expect(agents.processes).toHaveLength(2)
      two.becomeReady('a1', { resumed: true })
      two.turn.resolve(ok('end_turn'))
      await next.finished
      // Exactly one process is alive for the session: the second. The first one was closed.
      expect(processes.get('s1')).toBe(two)
      expect([one.closed, two.closed]).toEqual([1, 0])
    }
  )

  it('drops without a close the process that stopped by itself after Stop', async () => {
    const { processes, send, processOf } = setup()
    const { finished } = send('s1', 'Write a long answer')
    const one = await processOf(0)
    one.becomeReady('a1')
    await one.ready
    await Promise.resolve()
    const turn = processes.turnOf('s1')
    if (turn) turn.stopped = true
    one.turn.resolve(err('agent-stopped', 'Claude Code stopped (exit code 1).'))
    await finished
    expect(one.closed).toBe(0)
    expect(processes.get('s1')).toBeUndefined()
  })

  it('shows the message that names the agents.json entry when the program of the entry is missing, and keeps nothing alive', async () => {
    const { store, processes, send, processOf } = setup()
    const { finished } = send('s1', 'Say hello')
    const agent = await processOf(0)
    const message = 'The entry "claude-code" in agents.json names a program that Aether cannot find: C:\\gone.exe. Fix the entry or remove it.'
    agent.start.resolve(err('unavailable', message))
    await finished
    expect(entriesOf(store).at(-1)).toEqual({ kind: 'notice', tone: 'error', text: message, code: 'start-failed' })
    expect(processes.get('s1')).toBeUndefined()
    expect(agent.prompts).toEqual([])
    expect(agent.closed).toBe(1)
  })

  it('shows "not signed in" with the sign-in steps, keeps the process, and goes on (A8)', async () => {
    const { store, transcript, agents, send, processOf } = setup()
    const first = send('s1', 'Say hello')
    const agent = await processOf(0)
    agent.becomeReady('a1')
    agent.turn.resolve(err('not-signed-in', 'Claude Code is not signed in. Open a terminal.'))
    await first.finished
    expect(entriesOf(store).at(-1)).toEqual({
      kind: 'notice',
      tone: 'error',
      text: 'Claude Code is not signed in. Open a terminal.',
      code: 'not-signed-in'
    })
    expect(transcript.statusOf('s1')).toBe('idle')
    // The next message gets its answer from the same process.
    await send('s1', 'Say hello again').finished
    expect(agents.processes).toHaveLength(1)
    expect(agent.prompts).toEqual(['Say hello', 'Say hello again'])
  })

  it('shows "not signed in" when the start asks for it, and does not save the provider settings, so the user can fix the profile', async () => {
    const { store, processes, send, processOf } = setup()
    const { finished } = send('s1', 'Say hello')
    const agent = await processOf(0)
    agent.start.resolve(err('not-signed-in', 'Claude Code is not signed in. Open a terminal.'))
    await finished
    expect(entriesOf(store).at(-1)).toMatchObject({ kind: 'notice', code: 'not-signed-in' })
    expect(processes.get('s1')).toBeUndefined()
    expect(store.agentRunOf('s1')).toBeNull()
  })

  it('does not start the session when the agent refuses the mode or the model, and shows why', async () => {
    const { store, transcript, send, processOf } = setup()
    const { finished } = send('s1', 'Say hello')
    const agent = await processOf(0)
    agent.start.resolve(err('settings-refused', 'Claude Code did not accept the model "claude-opus-5-5".'))
    await finished
    expect(entriesOf(store).at(-1)).toEqual({
      kind: 'notice',
      tone: 'error',
      text: 'Claude Code did not accept the model "claude-opus-5-5".',
      code: 'start-failed'
    })
    expect(agent.prompts).toEqual([])
    expect(transcript.statusOf('s1')).toBe('idle')
    expect(store.agentRunOf('s1')).toBeNull()
  })

  it('shows one notice with the exit code when the process ends during a turn, and the next message starts a new process that resumes (A20)', async () => {
    const { store, processes, agents, send, processOf } = setup()
    const first = send('s1', 'Say hello')
    const one = await processOf(0)
    one.becomeReady('a1')
    one.turn.resolve(ok('end_turn'))
    await first.finished

    const second = send('s1', 'Say it again')
    // The process ends. The exit report comes before the failed prompt.
    const secondTurn = deferred<Result<StopReason, PromptErrorCode>>()
    one.prompt = () => secondTurn.promise
    one.listener.exited({ code: 7, logTail: 'simulated agent: the disk is full' })
    secondTurn.resolve(err('agent-stopped', 'Claude Code stopped (exit code 7).\nsimulated agent: the disk is full'))
    await second.finished
    const notices = entriesOf(store).filter((entry) => entry.kind === 'notice')
    expect(notices).toEqual([
      { kind: 'notice', tone: 'error', text: 'Claude Code stopped (exit code 7).\nsimulated agent: the disk is full', code: 'agent-stopped' }
    ])
    expect(processes.get('s1')).toBeUndefined()

    const third = send('s1', 'Are you back?')
    const two = await processOf(1)
    expect(agents.processes).toHaveLength(2)
    expect(two.input.resume).toBe('a1')
    two.becomeReady('a1', { resumed: true })
    two.turn.resolve(ok('end_turn'))
    await third.finished
    expect(two.prompts).toEqual(['Are you back?'])
  })

  it('starts a new agent session and shows a notice when the resume fails (A6, assumption of the brief)', async () => {
    const { database, store, processes, send, processOf } = setup()
    const first = send('s1', 'Say hello')
    const one = await processOf(0)
    one.becomeReady('a1')
    one.turn.resolve(ok('end_turn'))
    await first.finished
    one.listener.exited({ code: 0, logTail: '' })
    expect(processes.get('s1')).toBeUndefined()

    const second = send('s1', 'Are you still there?')
    const two = await processOf(1)
    two.becomeReady('a2', { resumeError: 'Unknown session' })
    two.turn.resolve(ok('end_turn'))
    await second.finished
    expect(entriesOf(store)).toContainEqual({
      kind: 'notice',
      tone: 'info',
      text: 'Aether could not continue the earlier conversation, so a new one starts. Unknown session',
      code: 'resume-failed'
    })
    expect(store.agentRunOf('s1')?.externalId).toBe('a2')
    // The run stays one row, and keeps its account.
    expect(database.prepare('SELECT count(*) AS total FROM agent_sessions').get()).toMatchObject({ total: 1 })
  })

  it('turns a defect into a notice, logs it, and leaves the session idle', async () => {
    const { store, transcript, agents, logged, send } = setup()
    agents.failWith = new Error('The program cannot start.')
    const { finished } = send('s1', 'Say hello')
    await finished
    expect(entriesOf(store).at(-1)).toMatchObject({ kind: 'notice', tone: 'error', code: 'defect' })
    expect(logged.join('\n')).toContain('The program cannot start.')
    expect(transcript.statusOf('s1')).toBe('idle')
  })

  it('never takes the folder, the mode or the model from the input', () => {
    expect(sendMessage.input.safeParse({ id: 's1', text: 'Hi', mode: 'approve-all' }).success).toBe(false)
    expect(sendMessage.input.safeParse({ id: 's1', text: 'Hi', cwd: 'C:\\elsewhere' }).success).toBe(false)
  })

  it('closes the text of the agent before the notice of a stop, so the order stays', async () => {
    const { store, send, processOf } = setup()
    const { finished } = send('s1', 'Say hello')
    const agent = await processOf(0)
    agent.becomeReady('a1')
    await agent.ready
    agent.say({ type: 'text', text: 'Part one.' })
    agent.turn.resolve(ok('cancelled'))
    await finished
    expect(entriesOf(store).map((entry) => entry.kind)).toEqual(['user', 'agent', 'notice'])
  })
  describe('the gate before a start (decision 0007)', () => {
    const refusal = (): StartGuard => () => Promise.resolve(err('trust-refused', 'Aether did not start the agent in this repository.'))

    it('asks the gate with the session, the profile and the folder of the saved row, before anything else', async () => {
      const { requests, send, processOf } = setup()
      const { finished } = send('s1', 'Say hello')
      const agent = await processOf(0)
      expect(requests).toEqual([{ sessionId: 's1', profileId: 'p1', folder: process.cwd() }])
      agent.becomeReady('a1')
      agent.turn.resolve(ok('end_turn'))
      await finished
    })

    it('starts nothing before the answer: no process, no account, no token query', async () => {
      let answer: (value: Result<unknown, string>) => void = () => undefined
      const waiting = new Promise<Result<unknown, string>>((resolve) => {
        answer = resolve
      })
      const { database, agents, tokens, transcript, send, processOf } = setup({ guard: () => waiting })
      const { finished } = send('s1', 'Say hello')
      for (let wait = 0; wait < 20; wait += 1) await Promise.resolve()
      expect(agents.processes).toHaveLength(0)
      expect(tokens).toEqual([])
      expect(database.prepare('SELECT count(*) AS total FROM providers').get()).toMatchObject({ total: 0 })
      expect(transcript.statusOf('s1')).toBe('starting')
      answer(ok({}))
      const agent = await processOf(0)
      agent.becomeReady('a1')
      agent.turn.resolve(ok('end_turn'))
      await finished
    })

    it('shows the refusal as an info notice, starts nothing and leaves the session idle', async () => {
      const { database, store, agents, tokens, transcript, send } = setup({ guard: refusal() })
      const { result, finished } = send('s1', 'Say hello')
      expect(result.ok).toBe(true)
      await finished
      expect(entriesOf(store)).toEqual([
        { kind: 'user', text: 'Say hello' },
        { kind: 'notice', tone: 'info', text: 'Aether did not start the agent in this repository.', code: 'trust-refused' }
      ])
      expect(agents.processes).toHaveLength(0)
      expect(tokens).toEqual([])
      expect(database.prepare('SELECT count(*) AS total FROM providers').get()).toMatchObject({ total: 0 })
      expect(transcript.statusOf('s1')).toBe('idle')
    })

    it('shows "Stopped." and not the refusal when the user stopped the turn', async () => {
      let answer: (value: Result<unknown, string>) => void = () => undefined
      const waiting = new Promise<Result<unknown, string>>((resolve) => {
        answer = resolve
      })
      const { store, processes, send } = setup({ guard: () => waiting })
      const { finished } = send('s1', 'Say hello')
      const turn = processes.turnOf('s1')
      if (turn) turn.stopped = true
      answer(err('trust-refused', 'Aether did not start the agent in this repository.'))
      await finished
      expect(entriesOf(store).at(-1)).toEqual({ kind: 'notice', tone: 'info', text: 'Stopped.', code: 'stopped' })
    })

    it('asks again for a resume, because a start without a process is a start, and not for a process that runs', async () => {
      const { requests, processes, send, processOf } = setup()
      const first = send('s1', 'Say hello')
      const agent = await processOf(0)
      agent.becomeReady('a1')
      agent.turn.resolve(ok('end_turn'))
      await first.finished
      expect(requests).toHaveLength(1)
      // The process is still alive: the next message does not ask.
      const second = send('s1', 'Again')
      for (let wait = 0; wait < 20; wait += 1) await Promise.resolve()
      expect(requests).toHaveLength(1)
      agent.turn.resolve(ok('end_turn'))
      await second.finished
      // The process is gone, for example after a release: the next message resumes, and asks.
      await processes.release('s1')
      const third = send('s1', 'After a release')
      const resumed = await processOf(1)
      expect(requests).toHaveLength(2)
      expect(resumed.input.resume).toBe('a1')
      resumed.becomeReady('a1')
      resumed.turn.resolve(ok('end_turn'))
      await third.finished
    })
  })
})
