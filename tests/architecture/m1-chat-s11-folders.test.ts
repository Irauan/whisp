// Story S11 of milestone m1-chat (sidebar folders and session status): the unit checks S11-18 and
// S11-19. Spec: `docs/milestones/m1-chat/stories/s11-sidebar-status.md`, "Checks" (level "Unit"),
// "Data" and "Interfaces".
//
// Coordinator decision (S5, S9 and S10 precedent): the locked unit checks of a story run as vitest
// tests in this folder, because `tsconfig.main.json` typechecks it.
//
// The interface that this test reads. Each name comes from the spec:
// - Migration 006 (`src/database/migrations/006-folders-and-unread.sql`): the table `folders` and the
//   column `sessions.unread`, as "Data" gives them. S10 adds migration 005 first, so a database "at
//   version 5" is the database of every migration below 006. The test seeds it only with the
//   columns of the migrations 001 to 004, so it does not depend on 005.
// - The contracts `folders.add { profileId, path }`, `folders.remove { folderId }` and
//   `sessions.list { profileId }`, whose result has `folders: { id, path, collapsed }[]`. The test
//   calls them through `composeMain` and `createInvoke`, as the window does (pattern:
//   `src/app/main/composition.test.ts`), so it reads no name inside a slice.
// - "Refused" is a result with `ok: false`: an error of the slice, or `invalid-input` of the contract.
// - "A duplicate returns the existing row": the second add of the same path gives the same result
//   as the first, and the profile still has one folder for the path.
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentPort } from '../../src/building-blocks/agent.port'
import { openDatabase } from '../../src/building-blocks/database'
import type { GithubPort, GithubTokenPort } from '../../src/building-blocks/github.port'
import { MIGRATIONS } from '../../src/building-blocks/migrations'
import { err, ok } from '../../src/building-blocks/result'
import { contracts } from '../../src/app/contracts'
import { composeMain, type Composition } from '../../src/app/main/composition'
import { createInvoke } from '../../src/app/main/ipc'

let base: string
let dataDir: string
let rootDir: string
let opened: Composition[] = []

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'aether-s11-folders-'))
  dataDir = join(base, 'data')
  rootDir = join(base, 'directories')
  await mkdir(dataDir)
  await mkdir(rootDir)
  opened = []
})

afterEach(async () => {
  for (const composition of opened) composition.close()
  await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

const github: GithubPort & GithubTokenPort = {
  listAccounts: async () => err('github-cli-missing', 'No gh.'),
  tokenOf: async (login) => ok(`fake-token-of-${login}`)
}

const noAgents: AgentPort = {
  start: () => {
    throw new Error('This test starts no agent.')
  }
}

type Answer = { ok: true; value: Record<string, unknown> } | { ok: false; error: { code: string; message: string } }

/** Starts the main process as the app does, and returns a call through `invoke`. */
function start() {
  const composed = composeMain({ dataDir, github, agents: noAgents, publish: () => undefined })
  if (!composed.ok) throw new Error(`${composed.error.code}: ${composed.error.message}`)
  opened.push(composed.value)
  const invoke = createInvoke({
    contracts,
    controllers: composed.value.controllers,
    isTrusted: () => true,
    log: (message, cause) => {
      throw new Error(`${message} ${String(cause)}`)
    }
  })
  return (name: string, input: unknown) => invoke({ sender: { id: 1, send: () => undefined, isDestroyed: () => false } }, name, input) as Promise<Answer>
}

/** Adds the profile "Personal" with the workspace directory, and returns its ID. */
async function addProfile(call: ReturnType<typeof start>): Promise<string> {
  const added = await call('profiles.add', { name: 'Personal', workspaceDirectory: rootDir, github: null, claudeFolder: null })
  if (!added.ok) throw new Error(`profiles.add failed: ${added.error.message}`)
  const listed = await call('profiles.list', {})
  if (!listed.ok) throw new Error(`profiles.list failed: ${listed.error.message}`)
  const profiles = listed.value.profiles as { id: string; name: string }[]
  const profile = profiles.find((candidate) => candidate.name === 'Personal')
  if (!profile) throw new Error('profiles.list has no profile "Personal".')
  return profile.id
}

interface FolderItem {
  id: string
  path: string
  collapsed: boolean
}

/** Compares two paths on Windows: case, separators and a trailing separator do not count. */
const samePath = (a: string, b: string) => {
  const clean = (path: string) => path.replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase()
  return clean(a) === clean(b)
}

/** The folders of `sessions.list`. */
async function foldersOf(call: ReturnType<typeof start>, profileId: string, check: string): Promise<FolderItem[]> {
  const listed = await call('sessions.list', { profileId })
  if (!listed.ok) throw new Error(`${check}: sessions.list failed: ${listed.error.message}`)
  const folders = listed.value.folders
  if (!Array.isArray(folders)) throw new Error(`${check}: the result of sessions.list has no list "folders": ${JSON.stringify(listed.value)}`)
  return folders as FolderItem[]
}

describe('S11-18: migration 006 adds the table folders and the column sessions.unread', () => {
  it('S11-18: a database at version 5 with sessions in two folders of one profile and one of another gets three folder rows with the oldest times, unread 0, and refuses the value 2', async () => {
    const check = 'S11-18'
    const versions = MIGRATIONS.map((migration) => migration.version)
    expect(versions, `${check}: the product has no migration 006 (src/database/migrations/006-folders-and-unread.sql).`).toContain(6)

    const path = join(base, 'aether.db')
    const first = openDatabase(path, MIGRATIONS.filter((migration) => migration.version < 6))
    if (!first.ok) throw new Error(`${check}: the database below version 6 does not open: ${first.error.message}`)
    const old = first.value.database
    const folderA = 'C:\\work\\repo-a'
    const folderB = 'C:\\work\\repo-b'
    old.prepare("INSERT INTO profiles (id, name, created_at) VALUES ('p1', 'Personal', '2026-01-01T00:00:00.000Z')").run()
    old.prepare("INSERT INTO profiles (id, name, created_at) VALUES ('p2', 'Client Example', '2026-01-01T00:00:00.000Z')").run()
    const insert = old.prepare(
      "INSERT INTO sessions (id, profile_id, title, prompt, mode, source_path, model, created_at) VALUES (?, ?, ?, ?, 'ask', ?, 'default', ?)"
    )
    // p1: two sessions in repo-a (the older one second), one in repo-b. p2: one in repo-a.
    insert.run('s1', 'p1', 'Fix the login page', 'Fix the login page', folderA, '2026-01-05T00:00:00.000Z')
    insert.run('s2', 'p1', 'Rename the old files', 'Rename the old files', folderA, '2026-01-02T00:00:00.000Z')
    insert.run('s3', 'p1', 'Sort the notes', 'Sort the notes', folderB, '2026-01-03T00:00:00.000Z')
    insert.run('s4', 'p2', 'Review the invoice export', 'Review the invoice export', folderA, '2026-01-04T00:00:00.000Z')
    old.close()

    const second = openDatabase(path, MIGRATIONS)
    if (!second.ok) throw new Error(`${check}: the migration to version 6 failed: ${second.error.message}`)
    const { database } = second.value
    try {
      expect(
        (database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
        `${check}: the database must reach version 6 or later.`
      ).toBeGreaterThanOrEqual(6)
      const folders = database.prepare('SELECT profile_id, path, collapsed, created_at FROM folders ORDER BY profile_id, path').all()
      expect(folders.map((row) => ({ ...row })), `${check}: folders must have one row for each folder of each profile, with the oldest session time.`).toEqual([
        { profile_id: 'p1', path: folderA, collapsed: 0, created_at: '2026-01-02T00:00:00.000Z' },
        { profile_id: 'p1', path: folderB, collapsed: 0, created_at: '2026-01-03T00:00:00.000Z' },
        { profile_id: 'p2', path: folderA, collapsed: 0, created_at: '2026-01-04T00:00:00.000Z' }
      ])
      const ids = database.prepare('SELECT id FROM folders').all() as { id: unknown }[]
      expect(
        ids.every((row) => typeof row.id === 'string' && row.id.length > 0),
        `${check}: each folder row needs a text ID.`
      ).toBe(true)
      expect(new Set(ids.map((row) => row.id)).size, `${check}: the folder IDs must differ.`).toBe(3)
      const unread = database.prepare('SELECT id, unread FROM sessions ORDER BY id').all()
      expect(unread.map((row) => ({ ...row })), `${check}: sessions.unread must be 0 for each session.`).toEqual(
        ['s1', 's2', 's3', 's4'].map((id) => ({ id, unread: 0 }))
      )
      // Both checks refuse the value 2.
      expect(() => database.prepare("UPDATE sessions SET unread = 2 WHERE id = 's1'").run(), `${check}: sessions.unread must refuse the value 2.`).toThrow()
      expect(() => database.prepare('UPDATE folders SET collapsed = 2').run(), `${check}: folders.collapsed must refuse the value 2.`).toThrow()
      // One row for each folder of a profile.
      expect(
        () => database.prepare("INSERT INTO folders (id, profile_id, path, created_at) VALUES ('f-copy', 'p1', ?, '2026-01-06T00:00:00.000Z')").run(folderA),
        `${check}: folders must refuse a second row for the same profile and path.`
      ).toThrow()
    } finally {
      database.close()
    }
  })
})

describe('S11-19: folders.add and folders.remove refuse what the spec refuses', () => {
  it('S11-19: folders.add refuses a missing path and a relative path, and gives the existing row for a duplicate', async () => {
    const check = 'S11-19'
    const call = start()
    const profileId = await addProfile(call)
    const notes = join(rootDir, 'notes')
    await mkdir(notes)

    const missing = await call('folders.add', { profileId, path: join(rootDir, 'missing') })
    expect(missing.ok, `${check}: folders.add must refuse a path that does not exist: ${JSON.stringify(missing)}`).toBe(false)
    const relative = await call('folders.add', { profileId, path: 'notes' })
    expect(relative.ok, `${check}: folders.add must refuse a relative path: ${JSON.stringify(relative)}`).toBe(false)
    expect(
      (await foldersOf(call, profileId, check)).filter((folder) => samePath(folder.path, notes)),
      `${check}: a refused add must add no folder.`
    ).toEqual([])

    const first = await call('folders.add', { profileId, path: notes })
    expect(first.ok, `${check}: folders.add refused an existing absolute folder: ${JSON.stringify(first)}`).toBe(true)
    const duplicate = await call('folders.add', { profileId, path: notes })
    expect(duplicate, `${check}: the add of a duplicate must give the existing row, as the first add did.`).toEqual(first)
    const listed = (await foldersOf(call, profileId, check)).filter((folder) => samePath(folder.path, notes))
    expect(listed, `${check}: the profile must have exactly one folder for the path after a duplicate add.`).toHaveLength(1)
    expect(listed[0], `${check}: a new folder starts expanded.`).toMatchObject({ collapsed: false })
  })

  it('S11-19: folders.remove refuses a folder with sessions, and removes a folder with none', async () => {
    const check = 'S11-19'
    const call = start()
    const profileId = await addProfile(call)
    const used = join(rootDir, 'repo-a')
    const empty = join(rootDir, 'empty')
    await mkdir(used)
    await mkdir(empty)
    for (const path of [used, empty]) {
      const added = await call('folders.add', { profileId, path })
      expect(added.ok, `${check}: folders.add refused ${path}: ${JSON.stringify(added)}`).toBe(true)
    }
    const created = await call('sessions.create', { profileId, prompt: 'Fix the login page', mode: 'ask', model: 'default', sourcePath: used, attachments: [] })
    expect(created.ok, `${check}: sessions.create failed: ${JSON.stringify(created)}`).toBe(true)

    const folderOf = async (path: string) => (await foldersOf(call, profileId, check)).find((folder) => samePath(folder.path, path))
    const usedFolder = await folderOf(used)
    const emptyFolder = await folderOf(empty)
    if (!usedFolder || !emptyFolder) throw new Error(`${check}: sessions.list does not list both added folders.`)

    const refused = await call('folders.remove', { folderId: usedFolder.id })
    expect(refused.ok, `${check}: folders.remove must refuse a folder with a session: ${JSON.stringify(refused)}`).toBe(false)
    expect(await folderOf(used), `${check}: a refused remove must keep the folder.`).toBeDefined()

    const removed = await call('folders.remove', { folderId: emptyFolder.id })
    expect(removed.ok, `${check}: folders.remove must remove a folder with no sessions: ${JSON.stringify(removed)}`).toBe(true)
    expect(await folderOf(empty), `${check}: the removed folder is still listed.`).toBeUndefined()
  })
})
