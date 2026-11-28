import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { SessionStore } from '../session.store'
import { createSession } from './create.contract'
import { createSessionController } from './create.controller'

let folder: string

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'aether-create-session-'))
})

afterEach(() => rm(folder, { recursive: true, force: true }))

function setup() {
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  const { database } = opened.value
  database.prepare("INSERT INTO profiles (id, name, created_at) VALUES ('w1', 'Personal', '2026-01-01')").run()
  let count = 0
  let minute = 0
  const create = createSessionController(
    database,
    { now: () => new Date(Date.UTC(2026, 0, 2, 3, (minute += 1))) },
    { next: () => `s${(count += 1)}` }
  )
  return { create, database, store: new SessionStore(database) }
}

const input = (sourcePath: string) => ({
  profileId: 'w1',
  prompt: 'Say hello\nThen list the files.',
  mode: 'plan' as const,
  model: 'claude-opus-5-5',
  sourcePath,
  attachments: [{ kind: 'file', ref: 'C:\\notes.txt', label: 'notes.txt' }]
})

describe('sessions.create', () => {
  it('saves the session as started by a person', async () => {
    const { create, store } = setup()
    await create(input(folder))
    expect(store.startedByOf('s1')).toBe('person')
  })

  it('saves the session row with the title, the mode, the folder and the attachments, and starts no agent', async () => {
    const { create, database, store } = setup()
    const result = await create(input(folder))
    expect(result).toEqual({ ok: true, value: { id: 's1' } })
    expect(createSession.output.safeParse(result).success).toBe(true)
    expect(store.find('s1')).toEqual({
      id: 's1',
      profileId: 'w1',
      title: 'Say hello',
      prompt: 'Say hello\nThen list the files.',
      mode: 'plan',
      providerId: null,
      sourcePath: folder,
      model: 'claude-opus-5-5',
      attachments: [{ kind: 'file', ref: 'C:\\notes.txt', label: 'notes.txt' }],
      createdAt: '2026-01-02T03:01:00.000Z'
    })
    expect(database.prepare('SELECT count(*) AS total FROM sessions').get()).toMatchObject({ total: 1 })
    // Only the sessions table changes: no provider row, because no agent starts.
    expect(database.prepare('SELECT count(*) AS total FROM providers').get()).toMatchObject({ total: 0 })
  })

  it('leaves the account of the session unset, so that the first start reads the current account of the profile (decision 0014)', async () => {
    const { create, store, database } = setup()
    database
      .prepare("INSERT INTO providers (id, profile_id, kind, label, settings, is_current, created_at) VALUES ('v1', 'w1', 'claude-code', 'Claude', '{}', 1, '2026-01-01')")
      .run()
    await create(input(folder))
    expect(store.find('s1')?.providerId).toBeNull()
  })

  it('saves Approve all as the user chose it', async () => {
    const { create, store } = setup()
    await create({ ...input(folder), mode: 'approve-all' })
    expect(store.find('s1')?.mode).toBe('approve-all')
  })

  it('lists the new session last, with the newest creation time', async () => {
    const { create, store } = setup()
    await create(input(folder))
    await create({ ...input(folder), prompt: 'Second' })
    expect(store.listByProfile('w1').map((session) => session.title)).toEqual(['Say hello', 'Second'])
  })

  it('refuses a profile that does not exist, and saves nothing', async () => {
    const { create, store } = setup()
    const result = await create({ ...input(folder), profileId: 'missing' })
    expect(result).toMatchObject({ ok: false, error: { code: 'unknown-profile' } })
    expect(createSession.output.safeParse(result).success).toBe(true)
    expect(store.listByProfile('missing')).toEqual([])
  })

  it('refuses a source path that is not an existing folder with an absolute path, and saves nothing', async () => {
    const { create, store } = setup()
    const file = join(folder, 'a-file.txt')
    await writeFile(file, 'x')
    for (const sourcePath of [join(folder, 'missing'), file, 'relative\\folder']) {
      expect(await create(input(sourcePath))).toMatchObject({ ok: false, error: { code: 'invalid-source-path' } })
    }
    expect(store.listByProfile('w1')).toEqual([])
  })
})
