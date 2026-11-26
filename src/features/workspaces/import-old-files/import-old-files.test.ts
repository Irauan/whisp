import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '../../../building-blocks/database'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { WorkspaceStore } from '../workspace.store'
import { importOldFilesHandler, UNREADABLE_MESSAGE } from './import-old-files.handler'
import { ImportStore } from './import-old-files.store'

let folder: string
let file: string
let database: Database

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'aether-import-'))
  file = join(folder, 'workspace.json')
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  database = opened.value.database
})

afterEach(() => rm(folder, { recursive: true, force: true }))

const at = '2026-01-01T00:00:00.000Z'

const draft = (id: string, accountId: string, mode: string, permissions: string) => ({
  id,
  accountId,
  title: `Title ${id}`,
  prompt: `Prompt ${id}`,
  settings: { folder: `C:\\code\\${id}`, mode, permissions, model: 'default', checkout: 'folder', attachments: [] },
  createdAt: at
})

const oldProfile = {
  version: 4,
  accounts: [
    { id: 'personal', label: 'Personal', github: null },
    { id: 'client', label: 'Client Example', github: { login: 'example-user', name: 'Example User', avatar: null } }
  ],
  currentAccountId: 'client',
  projects: [{ id: 'p1', name: 'Old project' }],
  workItems: [{ id: 'w1', title: 'Old item' }],
  sessions: [
    draft('s1', 'personal', 'plan', 'all'),
    draft('s2', 'client', 'interactive', 'all'),
    draft('s3', 'client', 'interactive', 'ask')
  ]
}

function run(ids = ['w-a', 'w-b', 's-1', 's-2', 's-3']) {
  let next = 0
  return importOldFilesHandler({
    workspaces: new WorkspaceStore(database),
    imports: new ImportStore(database),
    clock: { now: () => new Date('2026-02-03T04:05:06.000Z') },
    ids: { next: () => ids[next++] ?? `extra-${next}` },
    file
  })
}

const total = (table: string) => Number(database.prepare(`SELECT count(*) AS total FROM ${table}`).get()?.total)

describe('importOldFilesHandler', () => {
  it('imports each account as a workspace without a root, and each draft as a session with its mode', async () => {
    await writeFile(file, JSON.stringify(oldProfile))
    expect(run()).toEqual({ ok: true, value: { status: 'imported', workspaces: 2, sessions: 3 } })

    const store = new WorkspaceStore(database)
    expect(store.list()).toEqual([
      { id: 'w-a', name: 'Personal', root: null, github: null, claudeFolder: null, claudeProfile: null, createdAt: '2026-02-03T04:05:06.000Z' },
      {
        id: 'w-b',
        name: 'Client Example',
        root: null,
        github: { login: 'example-user', name: 'Example User', avatar: null },
        claudeFolder: null,
        claudeProfile: null,
        createdAt: '2026-02-03T04:05:06.000Z'
      }
    ])
    expect(store.currentId()).toBe('w-b')
    expect(database.prepare('SELECT id, workspace_id, title, prompt, mode, folder, model, attachments, created_at FROM sessions ORDER BY id').all()).toEqual([
      { id: 's-1', workspace_id: 'w-a', title: 'Title s1', prompt: 'Prompt s1', mode: 'plan', folder: 'C:\\code\\s1', model: 'default', attachments: '[]', created_at: at },
      { id: 's-2', workspace_id: 'w-b', title: 'Title s2', prompt: 'Prompt s2', mode: 'approve-all', folder: 'C:\\code\\s2', model: 'default', attachments: '[]', created_at: at },
      { id: 's-3', workspace_id: 'w-b', title: 'Title s3', prompt: 'Prompt s3', mode: 'ask', folder: 'C:\\code\\s3', model: 'default', attachments: '[]', created_at: at }
    ])
  })

  it('imports once: a second run changes nothing', async () => {
    await writeFile(file, JSON.stringify(oldProfile))
    run()
    expect(run(['x-1', 'x-2', 'x-3', 'x-4', 'x-5'])).toEqual({ ok: true, value: { status: 'already-imported' } })
    expect(total('workspaces')).toBe(2)
    expect(total('sessions')).toBe(3)
  })

  it('never writes the old files: workspace.json and runs/ stay byte-equal, also an unreadable conversation file', async () => {
    await writeFile(file, `${JSON.stringify(oldProfile)}\r\n`)
    await mkdir(join(folder, 'runs'))
    const conversation = '{"itemId":"work-item-1","entries":[\r\n'
    await writeFile(join(folder, 'runs', 'work-item-1.json'), conversation)
    const before = await readFile(file)

    run()
    run()

    expect((await readFile(file)).equals(before)).toBe(true)
    expect(await readFile(join(folder, 'runs', 'work-item-1.json'), 'utf8')).toBe(conversation)
  })

  it('imports nothing without the old file, and sets no mark', () => {
    expect(run()).toEqual({ ok: true, value: { status: 'no-file' } })
    expect(total('workspaces')).toBe(0)
    expect(new ImportStore(database).imported()).toBe(false)
  })

  it('returns an error for a file that Aether cannot read, imports nothing and sets no mark', async () => {
    const unreadable = '{"version":4,"accounts":[{"id":"personal","label":"Personal"\r\n'
    await writeFile(file, unreadable)
    expect(run()).toEqual({ ok: false, error: { code: 'workspace-file-unreadable', message: UNREADABLE_MESSAGE } })
    expect(total('workspaces')).toBe(0)
    expect(new ImportStore(database).imported()).toBe(false)
    expect(await readFile(file, 'utf8')).toBe(unreadable)

    // The user repairs the file by hand: the next start imports it.
    await writeFile(file, JSON.stringify(oldProfile))
    expect(run()).toMatchObject({ ok: true, value: { status: 'imported' } })
  })

  it('returns the same error when the path is a folder', async () => {
    await mkdir(file)
    expect(run()).toMatchObject({ ok: false, error: { code: 'workspace-file-unreadable' } })
  })

  it('rolls back all rows and the mark when a row fails', async () => {
    await writeFile(file, JSON.stringify(oldProfile))
    // The same ID twice breaks the primary key of the second workspace.
    expect(() => run(['same', 'same'])).toThrow()
    expect(total('workspaces')).toBe(0)
    expect(total('sessions')).toBe(0)
    expect(new ImportStore(database).imported()).toBe(false)
  })

  it('skips an invalid attachment, so that the first load of the sessions still works', async () => {
    const withBad = {
      ...oldProfile,
      sessions: [
        {
          ...draft('s1', 'personal', 'plan', 'all'),
          settings: {
            ...draft('s1', 'personal', 'plan', 'all').settings,
            attachments: [{ kind: '', ref: 'x', label: 'x' }, { kind: 'file', ref: 'C:\\a.txt', label: 'a.txt' }]
          }
        }
      ]
    }
    await writeFile(file, JSON.stringify(withBad))
    expect(run()).toMatchObject({ ok: true, value: { status: 'imported', sessions: 1 } })
    const row = database.prepare('SELECT attachments FROM sessions').get()
    expect(JSON.parse(String(row?.attachments))).toEqual([{ kind: 'file', ref: 'C:\\a.txt', label: 'a.txt' }])
  })

  it('keeps no old project and no old work item in the database', async () => {
    await writeFile(file, JSON.stringify(oldProfile))
    run()
    const rows = JSON.stringify(database.prepare('SELECT * FROM workspaces').all()) + JSON.stringify(database.prepare('SELECT * FROM sessions').all())
    expect(rows).not.toContain('Old project')
    expect(rows).not.toContain('Old item')
  })
})
