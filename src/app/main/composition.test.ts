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

function start(agents: AgentPort = noAgents) {
  published = []
  const composed = composeMain({
    dataDir,
    github,
    agents,
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
    const added = (await call('profiles.add', { name: 'Third', workspaceDirectory: rootDir, github: null, claudeFolder: null, claudeProfileName: null })) as {
      value: { id: string }
    }

    for (const [name, input] of [
      ['profiles.choose-directories', { directories: [{ profileId: personal!.id, workspaceDirectory: rootDir }, { profileId: client!.id, workspaceDirectory: rootDir }] }],
      ['profiles.edit', { id: client!.id, name: 'Renamed', workspaceDirectory: rootDir, github: null, claudeFolder: null, claudeProfileName: 'work' }],
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
      const agents = new AcpAgents({ recipe: claudeCodeRecipe({ override: async () => control.agent }), environment: () => ({ ...process.env, ANTHROPIC_API_KEY: 'x' }) })
      const first = start(agents)
      const added = (await first.call('profiles.add', { name: 'Third', workspaceDirectory: rootDir, github: { login: 'example-user', name: null, avatar: null }, claudeFolder: null, claudeProfileName: null })) as { ok: true }
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
})
