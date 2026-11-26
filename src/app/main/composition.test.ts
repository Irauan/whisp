import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { err } from '../../building-blocks/result'
import type { GithubPort } from '../../building-blocks/github.port'
import { contracts } from '../contracts'
import { composeMain, DATABASE_FILE, type Composition } from './composition'
import { createInvoke } from './ipc'

let dataDir: string
let rootDir: string
let open: Composition[] = []

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'aether-main-'))
  dataDir = join(base, 'data')
  rootDir = join(base, 'roots')
  await mkdir(dataDir)
  await mkdir(rootDir)
  open = []
})

afterEach(async () => {
  for (const composition of open) composition.close()
  await rm(join(dataDir, '..'), { recursive: true, force: true })
})

const github: GithubPort = { listAccounts: async () => err('github-cli-missing', 'No gh.') }

function start() {
  const composed = composeMain({ dataDir, github })
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
  const result = (await call('workspaces.list', {})) as {
    ok: true
    value: { workspaces: { id: string; name: string; root: string | null }[]; currentId: string | null; notices: { code: string }[] }
  }
  return result.value
}

describe('composeMain', () => {
  it('has one controller for each contract of the registry, and none more', () => {
    const { composition } = start()
    expect(Object.keys(composition.controllers).sort()).toEqual(contracts.map((contract) => contract.name).sort())
  })

  it('starts empty without an old file: no workspace, no message', async () => {
    const { call } = start()
    expect(await snapshotOf(call)).toEqual({ workspaces: [], currentId: null, notices: [] })
  })

  it('imports the old file at the first start, and not again at the second', async () => {
    await writeOldFiles()
    const first = start()
    const snapshot = await snapshotOf(first.call)
    expect(snapshot.workspaces.map((workspace) => [workspace.name, workspace.root])).toEqual([
      ['Personal', null],
      ['Client Example', null]
    ])
    first.composition.close()
    open = []

    const second = start()
    const again = await snapshotOf(second.call)
    expect(again.workspaces.map((workspace) => workspace.id)).toEqual(snapshot.workspaces.map((workspace) => workspace.id))
    const [client] = again.workspaces.filter((workspace) => workspace.name === 'Client Example')
    expect(await second.call('sessions.list', { workspaceId: client!.id })).toMatchObject({
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
    const { workspaces } = await snapshotOf(call)
    const [client] = workspaces.filter((workspace) => workspace.name === 'Client Example')
    expect(await call('sessions.list', { workspaceId: client!.id })).toMatchObject({
      ok: true,
      value: { sessions: [{ title: 'Review the invoice export', attachments: [] }] }
    })
  })

  it('never writes workspace.json or runs/: they stay byte-equal after the import and after each change', async () => {
    const old = await writeOldFiles()
    const conversation = await readFile(join(dataDir, 'runs', 'work-item-1.json'))
    const { call } = start()
    const { workspaces } = await snapshotOf(call)
    const [personal, client] = workspaces
    const added = (await call('workspaces.add', { name: 'Third', root: rootDir, github: null, claudeFolder: null, claudeProfile: null })) as {
      value: { id: string }
    }

    for (const [name, input] of [
      ['workspaces.choose-roots', { roots: [{ workspaceId: personal!.id, root: rootDir }, { workspaceId: client!.id, root: rootDir }] }],
      ['workspaces.edit', { id: client!.id, name: 'Renamed', root: rootDir, github: null, claudeFolder: null, claudeProfile: 'work' }],
      ['workspaces.switch', { id: personal!.id }],
      ['workspaces.remove', { id: added.value.id }],
      ['workspaces.remove', { id: client!.id }]
    ] as const) {
      expect(await call(name, input), name).toMatchObject({ ok: true })
    }

    expect((await readFile(join(dataDir, 'workspace.json'))).equals(old)).toBe(true)
    expect((await readFile(join(dataDir, 'runs', 'work-item-1.json'))).equals(conversation)).toBe(true)
    expect(await readdir(join(dataDir, 'runs'))).toEqual(['work-item-1.json'])
    expect((await readdir(dataDir)).sort()).toEqual(['aether.db', 'runs', 'workspace.json'])
  })

  it('keeps an unreadable workspace.json in place, shows a notice and imports nothing', async () => {
    const unreadable = Buffer.from('{"version":4,"accounts":[{"id":"personal","label":"Personal"\r\n')
    await writeFile(join(dataDir, 'workspace.json'), unreadable)
    const { call } = start()
    const snapshot = await snapshotOf(call)
    expect(snapshot.workspaces).toEqual([])
    expect(snapshot.notices).toMatchObject([{ code: 'workspace-file-unreadable', message: expect.stringMatching(/could not read workspace\.json/i) }])
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
    expect(snapshot.workspaces.map((workspace) => workspace.name)).toEqual(['Personal', 'Client Example'])
    expect((await readFile(join(dataDir, 'workspace.json'))).equals(old)).toBe(true)
  })

  it('refuses a database with a newer version and writes nothing', async () => {
    const newer = new DatabaseSync(join(dataDir, DATABASE_FILE))
    newer.exec('PRAGMA user_version = 99')
    newer.close()
    const before = await readFile(join(dataDir, DATABASE_FILE))
    expect(composeMain({ dataDir, github })).toMatchObject({ ok: false, error: { code: 'database-newer' } })
    expect((await readFile(join(dataDir, DATABASE_FILE))).equals(before)).toBe(true)
    expect(await readdir(dataDir)).toEqual([DATABASE_FILE])
  })
})
