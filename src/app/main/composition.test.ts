import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentPort } from '../../building-blocks/agent.port'
import { err, ok } from '../../building-blocks/result'
import type { GithubPort, GithubTokenPort } from '../../building-blocks/github.port'
import { ControlServer } from '../../../tests/simulated-agent/control'
import { AcpAgents } from '../../providers/acp/acp-agents'
import { claudeCodeRecipe } from '../../providers/claude-code/claude-code'
import type { ProjectScanner } from '../../building-blocks/project-scanner.port'
import { contracts } from '../contracts'
import { composeMain, DATABASE_FILE, type Composition } from './composition'
import { createInvoke } from './ipc'

let dataDir: string
let rootDir: string
let open: Composition[] = []

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'aether-main-'))
  dataDir = join(base, 'data')
  rootDir = join(base, 'directories')
  await mkdir(dataDir)
  await mkdir(rootDir)
  open = []
})

afterEach(async () => {
  for (const composition of open) composition.close()
  await rm(join(dataDir, '..'), { recursive: true, force: true })
})

const github: GithubPort & GithubTokenPort = {
  listAccounts: async () => err('github-cli-missing', 'No gh.'),
  tokenOf: async (login) => ok(`fake-token-of-${login}`)
}

/** A port for the tests that start no agent. */
const noAgents: AgentPort = {
  start: () => {
    throw new Error('This test starts no agent.')
  }
}

let published: { name: string; payload: unknown }[] = []
let wake: (() => void) | null = null

/** Waits until the check passes. It wakes at each published event, so no timer runs. */
async function until(check: () => boolean): Promise<void> {
  while (!check()) {
    await new Promise<void>((resolve) => {
      wake = resolve
    })
  }
}

interface Event {
  sessionId: string
  revision: number
  change: { type: string; status?: string }
}
const events = () => published.map((entry) => entry.payload as Event)
const isIdle = (event: Event) => event.change.type === 'status' && event.change.status === 'idle'

function start(agents: AgentPort = noAgents, scanner?: ProjectScanner) {
  published = []
  const composed = composeMain({
    dataDir,
    github,
    agents,
    scanner,
    publish: (name, payload) => {
      published.push({ name, payload })
      wake?.()
    }
  })
  if (!composed.ok) throw new Error(`${composed.error.code}: ${composed.error.message}`)
  open.push(composed.value)
  // The same entry as the app: the registry, the controllers and the checks of `invoke`.
  const invoke = createInvoke({
    contracts,
    controllers: composed.value.controllers,
    isTrusted: () => true,
    log: (message, cause) => {
      throw new Error(`${message} ${String(cause)}`)
    }
  })
  const call = (name: string, input: unknown) => invoke({ sender: { id: 1, send: () => undefined, isDestroyed: () => false } }, name, input)
  return { composition: composed.value, call }
}

const at = '2026-01-01T00:00:00.000Z'

const oldProfile = () => ({
  version: 4,
  accounts: [
    { id: 'personal', label: 'Personal', github: null },
    { id: 'client', label: 'Client Example', github: { login: 'example-user', name: 'Example User', avatar: null } }
  ],
  currentAccountId: 'personal',
  projects: [],
  workItems: [],
  sessions: [
    {
      id: 's1',
      accountId: 'client',
      title: 'Review the invoice export',
      prompt: 'Review the invoice export',
      settings: { folder: join(rootDir, 'repo'), mode: 'interactive', permissions: 'all', model: 'default', checkout: 'folder', attachments: [] },
      createdAt: at
    }
  ]
})

async function writeOldFiles() {
  const old = Buffer.from(`${JSON.stringify(oldProfile())}\r\n`)
  await writeFile(join(dataDir, 'workspace.json'), old)
  await mkdir(join(dataDir, 'runs'))
  await writeFile(join(dataDir, 'runs', 'work-item-1.json'), '{"itemId":"work-item-1","entries":[\r\n')
  return old
}

const snapshotOf = async (call: ReturnType<typeof start>['call']) => {
  const result = (await call('profiles.list', {})) as {
    ok: true
    value: { profiles: { id: string; name: string; workspaceDirectory: string | null }[]; currentId: string | null; notices: { code: string }[] }
  }
  return result.value
}

describe('composeMain', () => {
  it('has one controller for each contract of the registry, and none more', () => {
    const { composition } = start()
    expect(Object.keys(composition.controllers).sort()).toEqual(contracts.map((contract) => contract.name).sort())
  })

  it('starts empty without an old file: no profile, no message', async () => {
    const { call } = start()
    expect(await snapshotOf(call)).toEqual({ profiles: [], currentId: null, notices: [] })
  })

  it('imports the old file at the first start, and not again at the second', async () => {
    await writeOldFiles()
    const first = start()
    const snapshot = await snapshotOf(first.call)
    expect(snapshot.profiles.map((profile) => [profile.name, profile.workspaceDirectory])).toEqual([
      ['Personal', null],
      ['Client Example', null]
    ])
    first.composition.close()
    open = []

    const second = start()
    const again = await snapshotOf(second.call)
    expect(again.profiles.map((profile) => profile.id)).toEqual(snapshot.profiles.map((profile) => profile.id))
    const [client] = again.profiles.filter((profile) => profile.name === 'Client Example')
    expect(await second.call('sessions.list', { profileId: client!.id })).toMatchObject({
      ok: true,
      value: { sessions: [{ title: 'Review the invoice export', mode: 'approve-all' }] }
    })
  })

  it('loads the sessions of an old file that has an invalid attachment', async () => {
    const profile = oldProfile()
    const [draft] = profile.sessions
    draft!.settings = { ...draft!.settings, attachments: [{ kind: '', ref: 'x', label: 'x' }] as never }
    await writeFile(join(dataDir, 'workspace.json'), JSON.stringify(profile))
    const { call } = start()
    const { profiles } = await snapshotOf(call)
    const [client] = profiles.filter((profile) => profile.name === 'Client Example')
    expect(await call('sessions.list', { profileId: client!.id })).toMatchObject({
      ok: true,
      value: { sessions: [{ title: 'Review the invoice export', attachments: [] }] }
    })
  })

  it('never writes workspace.json or runs/: they stay byte-equal after the import and after each change', async () => {
    const old = await writeOldFiles()
    const conversation = await readFile(join(dataDir, 'runs', 'work-item-1.json'))
    const { call } = start()
    const { profiles } = await snapshotOf(call)
    const [personal, client] = profiles
    const added = (await call('profiles.add', { name: 'Third', workspaceDirectory: rootDir, github: null, claudeFolder: null })) as {
      value: { id: string }
    }

    for (const [name, input] of [
      ['profiles.choose-directories', { directories: [{ profileId: personal!.id, workspaceDirectory: rootDir }, { profileId: client!.id, workspaceDirectory: rootDir }] }],
      ['profiles.edit', { id: client!.id, name: 'Renamed', workspaceDirectory: rootDir, github: null, claudeFolder: null }],
      ['profiles.switch', { id: personal!.id }],
      ['profiles.remove', { id: added.value.id }],
      ['profiles.remove', { id: client!.id }]
    ] as const) {
      expect(await call(name, input), name).toMatchObject({ ok: true })
    }

    expect((await readFile(join(dataDir, 'workspace.json'))).equals(old)).toBe(true)
    expect((await readFile(join(dataDir, 'runs', 'work-item-1.json'))).equals(conversation)).toBe(true)
    expect(await readdir(join(dataDir, 'runs'))).toEqual(['work-item-1.json'])
    expect((await readdir(dataDir)).sort()).toEqual(['aether.db', 'runs', 'workspace.json'])
  })

  it('creates, lists, opens and deletes sessions through invoke, and leaves the old files byte-equal', async () => {
    const old = await writeOldFiles()
    const { call } = start()
    const { profiles } = await snapshotOf(call)
    const [client] = profiles.filter((profile) => profile.name === 'Client Example')
    const input = { profileId: client!.id, prompt: 'Say hello', mode: 'approve-all', model: 'default', sourcePath: rootDir, attachments: [] }

    const created = (await call('sessions.create', input)) as { ok: true; value: { id: string } }
    expect(created).toMatchObject({ ok: true })
    // The imported draft is Approve all, and so is the new session. The next new session shows Ask.
    expect(await call('sessions.list', { profileId: client!.id })).toMatchObject({
      ok: true,
      value: { sessions: [{ title: 'Review the invoice export' }, { title: 'Say hello', mode: 'approve-all' }], newSessionMode: 'ask' }
    })
    expect(await call('sessions.open', { id: created.value.id })).toMatchObject({ ok: true, value: { session: { prompt: 'Say hello' } } })
    expect(await call('sessions.create', { ...input, sourcePath: join(rootDir, 'missing') })).toMatchObject({
      ok: false,
      error: { code: 'invalid-source-path' }
    })
    expect(await call('sessions.create', { ...input, mode: 'interactive' })).toMatchObject({ ok: false, error: { code: 'invalid-input' } })

    expect(await call('sessions.delete', { id: created.value.id })).toEqual({ ok: true, value: {} })
    expect(await call('sessions.open', { id: created.value.id })).toMatchObject({ ok: false, error: { code: 'unknown-session' } })
    expect(await call('sessions.list', { profileId: client!.id })).toMatchObject({ ok: true, value: { sessions: [{ title: 'Review the invoice export' }] } })

    expect((await readFile(join(dataDir, 'workspace.json'))).equals(old)).toBe(true)
    expect((await readdir(dataDir)).sort()).toEqual(['aether.db', 'runs', 'workspace.json'])
  })

  it('chats with a real agent process through invoke: send, stream, save, resume after a restart, and end the process on shutdown', async () => {
    const control = await ControlServer.start()
    try {
      await control.scenario('text', { chunks: ['Hello ', 'from the agent.'] })
      const agents = new AcpAgents({ recipe: claudeCodeRecipe({ override: async () => ok(control.agent) }), environment: () => ({ ...process.env, ANTHROPIC_API_KEY: 'x' }) })
      const first = start(agents)
      const added = (await first.call('profiles.add', { name: 'Third', workspaceDirectory: rootDir, github: { login: 'example-user', name: null, avatar: null }, claudeFolder: null })) as { ok: true }
      expect(added.ok).toBe(true)
      const [profile] = (await snapshotOf(first.call)).profiles
      const created = (await first.call('sessions.create', { profileId: profile!.id, prompt: 'Say hello', mode: 'plan', model: 'default', sourcePath: rootDir, attachments: [] })) as { ok: true; value: { id: string } }
      const id = created.value.id

      expect(await first.call('sessions.send-message', { id, text: 'Say hello' })).toEqual({ ok: true, value: {} })
      await until(() => events().some(isIdle))
      expect(control.received('session/set_mode')[0]?.params).toMatchObject({ modeId: 'plan' })
      const opened = (await first.call('sessions.open', { id })) as { ok: true; value: { entries: { entry: object }[]; status: string; revision: number; draft: boolean } }
      expect(opened.value.entries.map((view) => view.entry)).toEqual([
        { kind: 'user', text: 'Say hello' },
        { kind: 'agent', text: 'Hello from the agent.' }
      ])
      expect(opened.value).toMatchObject({ status: 'idle', draft: false, revision: events().at(-1)?.revision })
      expect(published.every((entry) => entry.name === 'sessions.changed')).toBe(true)
      // The mode of a session that started cannot change.
      expect(await first.call('sessions.set-mode', { id, mode: 'ask' })).toMatchObject({ ok: false, error: { code: 'session-started' } })

      // The agent has the token of the GitHub account of the profile, and nothing of the environment of Aether.
      const { env } = await control.waitForEnvironment()
      expect(env.GH_TOKEN).toBe('fake-token-of-example-user')
      expect(env.ANTHROPIC_API_KEY).toBeUndefined()

      // Shutdown ends the process. A restart resumes the same agent session.
      await first.composition.shutdown()
      expect(await control.waitForClose()).toBeTypeOf('number')
      first.composition.close()
      open = []

      const second = start(agents)
      published = []
      await control.scenario('text', { chunks: ['Welcome ', 'back.'] })
      expect(await second.call('sessions.send-message', { id, text: 'Are you still there?' })).toEqual({ ok: true, value: {} })
      await until(() => events().some(isIdle))
      expect(control.received('session/resume')[0]?.params).toMatchObject({ sessionId: 's1' })
      expect(control.received('session/new')).toHaveLength(1)
      expect(control.pids).toHaveLength(2)

      // Deleting the session ends its process.
      expect(await second.call('sessions.delete', { id })).toEqual({ ok: true, value: {} })
      expect(await control.waitForClose()).toBeTypeOf('number')
    } finally {
      for (const composition of open) await composition.shutdown()
      await control.close()
    }
  })

  it('keeps the settings that a process started with: an edit of the account during the first start makes a new account, and the resume uses the old one (R2-1)', async () => {
    // A port whose processes wait for the test.
    interface Fake {
      input: Parameters<AgentPort['start']>[0]
      ready(id: string): void
      end(): void
    }
    const fakes: Fake[] = []
    let announce: () => void = () => undefined
    const agents: AgentPort = {
      start: (input, listener) => {
        let resolveReady: (value: ReturnType<typeof ok<{ agentSessionId: string; resumed: boolean; resumeError: string | null }>>) => void = () => undefined
        const readyPromise = new Promise<ReturnType<typeof ok<{ agentSessionId: string; resumed: boolean; resumeError: string | null }>>>((resolve) => {
          resolveReady = resolve
        })
        fakes.push({
          input,
          ready: (agentSessionId) => resolveReady(ok({ agentSessionId, resumed: input.resume !== null, resumeError: null })),
          end: () => listener.exited({ code: 0, logTail: '' })
        })
        announce()
        return {
          ready: readyPromise,
          prompt: async () => ok('end_turn' as const),
          cancel: async () => undefined,
          close: async () => undefined
        }
      }
    }
    const started = async (count: number) => {
      while (fakes.length < count) {
        await new Promise<void>((resolve) => {
          announce = resolve
        })
      }
    }

    const { composition, call } = start(agents)
    const folders = { f1: join(rootDir, 'claude-f1'), f3: join(rootDir, 'claude-f3') }
    await call('profiles.add', { name: 'Third', workspaceDirectory: rootDir, github: null, claudeFolder: folders.f1 })
    const [profile] = (await snapshotOf(call)).profiles
    const created = (await call('sessions.create', { profileId: profile!.id, prompt: 'Say hello', mode: 'ask', model: 'default', sourcePath: rootDir, attachments: [] })) as { ok: true; value: { id: string } }
    const id = created.value.id

    // The process starts with F1. It is not ready, so no agent run names the account yet.
    expect(await call('sessions.send-message', { id, text: 'Say hello' })).toEqual({ ok: true, value: {} })
    await started(1)
    expect(fakes[0]!.input.settings).toEqual({ configFolder: folders.f1 })
    // The user edits the Claude folder of the profile in this time.
    expect(await call('profiles.edit', { id: profile!.id, name: 'Third', workspaceDirectory: rootDir, github: null, claudeFolder: folders.f3 })).toMatchObject({ ok: true })
    fakes[0]!.ready('agent-1')
    await until(() => events().some(isIdle))

    // The account that the agent run names holds F1, and F3 is a new current account.
    const readDatabase = () => new DatabaseSync(join(dataDir, DATABASE_FILE), { readOnly: true })
    const database = readDatabase()
    try {
      const accounts = database.prepare('SELECT id, settings, is_current FROM providers ORDER BY created_at, rowid').all()
      expect(accounts.map((row) => [row.settings, row.is_current])).toEqual([
        [JSON.stringify({ configFolder: folders.f1 }), 0],
        [JSON.stringify({ configFolder: folders.f3 }), 1]
      ])
      expect(database.prepare('SELECT provider_id, external_id FROM agent_sessions').all()).toEqual([{ provider_id: accounts[0]!.id, external_id: 'agent-1' }])
    } finally {
      database.close()
    }

    // The process ends. The resume uses the settings that the first process started with.
    published = []
    fakes[0]!.end()
    expect(await call('sessions.send-message', { id, text: 'Are you still there?' })).toEqual({ ok: true, value: {} })
    await started(2)
    expect(fakes[1]!.input.settings).toEqual({ configFolder: folders.f1 })
    expect(fakes[1]!.input.resume).toBe('agent-1')
    fakes[1]!.ready('agent-1')
    await until(() => events().some(isIdle))
    await composition.shutdown()
  })

  it('keeps an unreadable workspace.json in place, shows a notice and imports nothing', async () => {
    const unreadable = Buffer.from('{"version":4,"accounts":[{"id":"personal","label":"Personal"\r\n')
    await writeFile(join(dataDir, 'workspace.json'), unreadable)
    const { call } = start()
    const snapshot = await snapshotOf(call)
    expect(snapshot.profiles).toEqual([])
    expect(snapshot.notices).toMatchObject([{ code: 'workspace-file-unreadable', message: expect.stringMatching(/could not read workspace.json/i) }])
    expect((await readFile(join(dataDir, 'workspace.json'))).equals(unreadable)).toBe(true)
    expect((await readdir(dataDir)).sort()).toEqual(['aether.db', 'workspace.json'])
  })

  it('keeps an unreadable database aside, shows a notice and starts with a new database', async () => {
    const text = Buffer.from('This is not a SQLite database.\r\n'.repeat(64))
    await writeFile(join(dataDir, DATABASE_FILE), text)
    const old = await writeOldFiles()
    const { call } = start()
    const snapshot = await snapshotOf(call)
    expect(snapshot.notices).toMatchObject([{ code: 'database-unreadable', message: expect.stringMatching(/could not read its database/i) }])
    const aside = (await readdir(dataDir)).filter((name) => name.startsWith('aether.db.unreadable-'))
    expect(aside).toHaveLength(1)
    expect((await readFile(join(dataDir, aside[0]!))).equals(text)).toBe(true)
    // The new database imports the old file again: the accounts come back.
    expect(snapshot.profiles.map((profile) => profile.name)).toEqual(['Personal', 'Client Example'])
    expect((await readFile(join(dataDir, 'workspace.json'))).equals(old)).toBe(true)
  })

  it('refuses a database with a newer version and writes nothing', async () => {
    const newer = new DatabaseSync(join(dataDir, DATABASE_FILE))
    newer.exec('PRAGMA user_version = 99')
    newer.close()
    const before = await readFile(join(dataDir, DATABASE_FILE))
    expect(composeMain({ dataDir, github, agents: noAgents, publish: () => undefined })).toMatchObject({ ok: false, error: { code: 'database-newer' } })
    expect((await readFile(join(dataDir, DATABASE_FILE))).equals(before)).toBe(true)
    expect(await readdir(dataDir)).toEqual([DATABASE_FILE])
  })
  describe('the trust and directory questions (decision 0007)', () => {
    /** A port that counts its starts. Each process is ready at once and ends its turn at once. */
    function countingAgents() {
      const starts: Parameters<AgentPort['start']>[0][] = []
      const port: AgentPort = {
        start: (input) => {
          starts.push(input)
          return {
            ready: Promise.resolve(ok({ agentSessionId: `agent-${starts.length}`, resumed: false, resumeError: null })),
            prompt: async () => ok('end_turn' as const),
            cancel: async () => undefined,
            close: async () => undefined
          }
        }
      }
      return { starts, port }
    }

    type Listed = { ok: true; value: { revision: number; questions: { id: string; sessionId: string; kind: string }[] } }

    async function setupRepository(scanner?: ProjectScanner) {
      const { starts, port } = countingAgents()
      const repository = join(rootDir, 'repo-b')
      await mkdir(join(repository, '.git'), { recursive: true })
      const composed = start(port, scanner)
      await composed.call('profiles.add', { name: 'Third', workspaceDirectory: rootDir, github: null, claudeFolder: null })
      const [profile] = (await snapshotOf(composed.call)).profiles
      const create = async (prompt: string) => {
        const created = (await composed.call('sessions.create', { profileId: profile!.id, prompt, mode: 'ask', model: 'default', sourcePath: repository, attachments: [] })) as { ok: true; value: { id: string } }
        return created.value.id
      }
      const list = async () => (await composed.call('repositories.list-questions', {})) as Listed
      const questionOf = async () => {
        while ((await list()).value.questions.length === 0) await new Promise<void>((resolve) => setImmediate(resolve))
        return (await list()).value.questions[0]!
      }
      return { ...composed, starts, create, list, questionOf }
    }

    it('asks before any agent process starts, and starts the session after "Trust"', async () => {
      const { call, starts, create, list, questionOf } = await setupRepository()
      const id = await create('Fix the login page')
      expect(await call('sessions.send-message', { id, text: 'Fix the login page' })).toEqual({ ok: true, value: {} })
      const question = await questionOf()
      expect(question).toMatchObject({ kind: 'trust', sessionId: id })
      expect(starts).toHaveLength(0)
      // The event carries the change and its revision, and the snapshot has the same revision.
      const opened = published.filter((entry) => entry.name === 'repositories.questions-changed').map((entry) => entry.payload)
      expect(opened).toMatchObject([{ revision: 1, change: { type: 'opened', question: { id: question.id } } }])
      expect((await list()).value.revision).toBe(1)

      expect(await call('repositories.answer-question', { sessionId: id, questionId: question.id, answer: 'allow-once' })).toMatchObject({ ok: false, error: { code: 'answer-not-offered' } })
      expect(await call('repositories.answer-question', { sessionId: id, questionId: question.id, answer: 'trust' })).toEqual({ ok: true, value: {} })
      await until(() => events().some(isIdle))
      expect(starts).toHaveLength(1)
      expect((await list()).value.questions).toEqual([])

      // The answer is stored: a second session in the repository asks nothing.
      const second = await create('List the open issues')
      published = []
      expect(await call('sessions.send-message', { id: second, text: 'List the open issues' })).toEqual({ ok: true, value: {} })
      await until(() => events().some(isIdle))
      expect(starts).toHaveLength(2)
      expect(published.some((entry) => entry.name === 'repositories.questions-changed')).toBe(false)
    })

    it('ends the turn with the notice of the state Trust refused after "Cancel", and starts nothing', async () => {
      const { call, starts, create, questionOf } = await setupRepository()
      const id = await create('Fix the login page')
      await call('sessions.send-message', { id, text: 'Fix the login page' })
      const question = await questionOf()
      await call('repositories.answer-question', { sessionId: id, questionId: question.id, answer: 'cancel' })
      await until(() => events().some(isIdle))
      expect(starts).toHaveLength(0)
      expect(await call('sessions.open', { id })).toMatchObject({
        ok: true,
        value: { entries: [{ entry: { kind: 'user' } }, { entry: { kind: 'notice', tone: 'info', text: 'Aether did not start the agent in this repository.' } }], status: 'idle' }
      })
    })

    it('answers "cancel" for the open question when the user stops the session', async () => {
      const { call, starts, create, list, questionOf } = await setupRepository()
      const id = await create('Fix the login page')
      await call('sessions.send-message', { id, text: 'Fix the login page' })
      await questionOf()
      expect(await call('sessions.stop', { id })).toEqual({ ok: true, value: {} })
      await until(() => events().some(isIdle))
      expect((await list()).value.questions).toEqual([])
      expect(starts).toHaveLength(0)
      expect(await call('sessions.open', { id })).toMatchObject({ ok: true, value: { entries: [{ entry: { kind: 'user' } }, { entry: { text: 'Stopped.' } }] } })
    })

    it('answers "cancel" for an open question when the session is deleted, and when Aether shuts down', async () => {
      const { call, composition, starts, create, list, questionOf } = await setupRepository()
      const first = await create('Fix the login page')
      await call('sessions.send-message', { id: first, text: 'Fix the login page' })
      await questionOf()
      expect(await call('sessions.delete', { id: first })).toEqual({ ok: true, value: {} })
      expect((await list()).value.questions).toEqual([])

      const second = await create('Review the login page')
      await call('sessions.send-message', { id: second, text: 'Review the login page' })
      await questionOf()
      // Without the wake-up, the shutdown would wait for ever for the turn that waits for the answer.
      await composition.shutdown()
      expect((await list()).value.questions).toEqual([])
      expect(starts).toHaveLength(0)
    })
    it('asks for trust in a plain folder with an empty .claude/settings.local.json, through the scanner of Claude Code, and starts nothing (F1, F2)', async () => {
      const { starts, port } = countingAgents()
      const plain = join(rootDir, 'notes-tool')
      await mkdir(join(plain, '.claude'), { recursive: true })
      await writeFile(join(plain, '.claude', 'settings.local.json'), '{}')
      // No scanner is passed: the composition uses the default one, as the app does.
      const { call, composition } = start(port)
      await call('profiles.add', { name: 'Third', workspaceDirectory: rootDir, github: null, claudeFolder: null })
      const [profile] = (await snapshotOf(call)).profiles
      const created = (await call('sessions.create', { profileId: profile!.id, prompt: 'Sort the notes', mode: 'ask', model: 'default', sourcePath: plain, attachments: [] })) as { ok: true; value: { id: string } }
      await call('sessions.send-message', { id: created.value.id, text: 'Sort the notes' })
      let listed: Listed
      do {
        await new Promise<void>((resolve) => setImmediate(resolve))
        listed = (await call('repositories.list-questions', {})) as Listed
      } while (listed.value.questions.length === 0)
      expect(listed.value.questions[0]).toMatchObject({
        kind: 'trust',
        sessionId: created.value.id,
        repository: 'notes-tool',
        files: [{ name: join('.claude', 'settings.local.json'), keys: [] }]
      })
      expect(starts).toHaveLength(0)
      await composition.shutdown()
    })

    describe('a stop, a delete or a quit during the scan of the folder (F3)', () => {
      /** The reproduction of the reviewer: the scan waits for the test, and the user cancels in that time. */
      async function duringScan(cancel: (ctx: Awaited<ReturnType<typeof setupRepository>>, id: string) => Promise<void>) {
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => {
          release = resolve
        })
        const scanner: ProjectScanner = {
          scan: async () => {
            await gate
            return { hooks: [], mcpServers: [], files: [], unreadable: [] }
          }
        }
        const ctx = await setupRepository(scanner)
        const id = await ctx.create('Fix the login page')
        await ctx.call('sessions.send-message', { id, text: 'Fix the login page' })
        for (let wait = 0; wait < 30; wait += 1) await new Promise<void>((resolve) => setImmediate(resolve))
        await cancel(ctx, id)
        release()
        for (let wait = 0; wait < 30; wait += 1) await new Promise<void>((resolve) => setImmediate(resolve))
        return { ...ctx, id }
      }

      it('opens no question after Stop, and the turn ends with "Stopped."', async () => {
        const ctx = await duringScan(async ({ call }, id) => void (await call('sessions.stop', { id })))
        expect((await ctx.list()).value.questions).toEqual([])
        expect(ctx.starts).toHaveLength(0)
        expect(await ctx.call('sessions.open', { id: ctx.id })).toMatchObject({
          ok: true,
          value: { status: 'idle', entries: [{ entry: { kind: 'user' } }, { entry: { text: 'Stopped.' } }] }
        })
      })

      it('opens no question after a delete of the session', async () => {
        const ctx = await duringScan(async ({ call }, id) => void (await call('sessions.delete', { id })))
        expect((await ctx.list()).value.questions).toEqual([])
        expect(ctx.starts).toHaveLength(0)
      })

      it('opens no question after a shutdown, and the shutdown ends', async () => {
        let ended = false
        const ctx = await duringScan(async ({ composition }) => {
          void composition.shutdown().then(() => {
            ended = true
          })
        })
        expect((await ctx.list()).value.questions).toEqual([])
        expect(ctx.starts).toHaveLength(0)
        for (let wait = 0; wait < 30 && !ended; wait += 1) await new Promise<void>((resolve) => setImmediate(resolve))
        expect(ended).toBe(true)
      })
    })

    describe('a stop, a delete or a quit during the gate of the main folder, with an additional directory outside (A15 with A10)', () => {
      /**
       * The main folder is a plain folder in the workspace directory: its scan asks nothing. The
       * session has a folder attachment outside the workspace directory: it would ask the directory
       * question. The cancel comes while the scan of the main folder waits.
       */
      async function duringMainFolderScan(cancel: (ctx: { call: ReturnType<typeof start>['call']; composition: Composition }, id: string) => Promise<void>) {
        const { starts, port } = countingAgents()
        let release: () => void = () => undefined
        const gate = new Promise<void>((resolve) => {
          release = resolve
        })
        let scans = 0
        const scanner: ProjectScanner = {
          scan: async () => {
            scans += 1
            if (scans === 1) await gate
            return { hooks: [], mcpServers: [], files: [], unreadable: [] }
          }
        }
        const plain = join(rootDir, 'plain')
        await mkdir(plain, { recursive: true })
        const elsewhere = join(dataDir, '..', 'elsewhere')
        await mkdir(elsewhere, { recursive: true })
        const composed = start(port, scanner)
        await composed.call('profiles.add', { name: 'Third', workspaceDirectory: rootDir, github: null, claudeFolder: null })
        const [profile] = (await snapshotOf(composed.call)).profiles
        const created = (await composed.call('sessions.create', {
          profileId: profile!.id,
          prompt: 'Sort',
          mode: 'ask',
          model: 'default',
          sourcePath: plain,
          attachments: [{ kind: 'folder', ref: elsewhere, label: 'elsewhere' }]
        })) as { ok: true; value: { id: string } }
        const id = created.value.id
        await composed.call('sessions.send-message', { id, text: 'Sort' })
        for (let wait = 0; wait < 30 && scans === 0; wait += 1) await new Promise<void>((resolve) => setImmediate(resolve))
        expect(scans).toBe(1)
        await cancel(composed, id)
        release()
        for (let wait = 0; wait < 60; wait += 1) await new Promise<void>((resolve) => setImmediate(resolve))
        const listed = (await composed.call('repositories.list-questions', {})) as Listed
        return { ...composed, id, starts, scans: () => scans, questions: listed.value.questions }
      }

      it('opens no question after Stop, starts no process, and the turn ends with "Stopped."', async () => {
        const ctx = await duringMainFolderScan(async ({ call }, id) => void (await call('sessions.stop', { id })))
        expect(ctx.questions).toEqual([])
        expect(ctx.starts).toHaveLength(0)
        // The gate for the additional directory never ran.
        expect(ctx.scans()).toBe(1)
        expect(await ctx.call('sessions.open', { id: ctx.id })).toMatchObject({
          ok: true,
          value: { status: 'idle', entries: [{ entry: { kind: 'user' } }, { entry: { text: 'Stopped.' } }] }
        })
      })

      it('opens no question after a delete of the session, and starts no process', async () => {
        const ctx = await duringMainFolderScan(async ({ call }, id) => void (await call('sessions.delete', { id })))
        expect(ctx.questions).toEqual([])
        expect(ctx.starts).toHaveLength(0)
      })

      it('opens no question after a shutdown, starts no process, and the shutdown ends', async () => {
        let ended = false
        const ctx = await duringMainFolderScan(async ({ composition }) => {
          void composition.shutdown().then(() => {
            ended = true
          })
        })
        expect(ctx.questions).toEqual([])
        expect(ctx.starts).toHaveLength(0)
        for (let wait = 0; wait < 30 && !ended; wait += 1) await new Promise<void>((resolve) => setImmediate(resolve))
        expect(ended).toBe(true)
      })
    })
  })
})
