import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { SessionStore } from '../session.store'
import { Transcript } from '../transcript.store'
import { listSessions, sessionItemSchema } from './list.contract'
import { listSessionsController } from './list.controller'

function setup() {
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  const { database } = opened.value
  for (const id of ['w1', 'w2']) {
    database.prepare("INSERT INTO profiles (id, name, created_at) VALUES (?, ?, '2026-01-01')").run(id, id)
  }
  const insert = database.prepare(
    'INSERT INTO sessions (id, profile_id, title, prompt, mode, source_path, model, attachments, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  )
  const store = new SessionStore(database)
  let next = 0
  const transcript = new Transcript(store, () => undefined, { now: () => new Date('2026-03-01T00:00:00.000Z') }, { next: () => `id-${(next += 1)}` })
  return { database, insert, store, transcript, list: listSessionsController(database, transcript) }
}

describe('sessions.list', () => {
  it('lists the sessions of one profile, oldest first, with all their fields and the idle live state', async () => {
    const { insert, list } = setup()
    const attachments = JSON.stringify([{ kind: 'file', ref: 'C:\\notes.txt', label: 'notes.txt' }])
    insert.run('s2', 'w1', 'Second', 'Second prompt', 'plan', 'C:\\work', 'claude-opus-5-5', attachments, '2026-01-02')
    insert.run('s1', 'w1', 'First', 'First prompt', 'approve-all', 'C:\\work', 'default', '[]', '2026-01-01')
    insert.run('s3', 'w2', 'Other', 'Other prompt', 'ask', 'C:\\other', 'default', '[]', '2026-01-01')

    const result = await list({ profileId: 'w1' })
    expect(result).toMatchObject({
      ok: true,
      value: {
        sessions: [
          {
            id: 's1',
            profileId: 'w1',
            title: 'First',
            prompt: 'First prompt',
            mode: 'approve-all',
            providerId: null,
            sourcePath: 'C:\\work',
            model: 'default',
            attachments: [],
            createdAt: '2026-01-01',
            unread: false,
            status: 'idle',
            openCardIds: [],
            revision: 0
          },
          {
            id: 's2',
            profileId: 'w1',
            title: 'Second',
            prompt: 'Second prompt',
            mode: 'plan',
            providerId: null,
            sourcePath: 'C:\\work',
            model: 'claude-opus-5-5',
            attachments: [{ kind: 'file', ref: 'C:\\notes.txt', label: 'notes.txt' }],
            createdAt: '2026-01-02',
            unread: false,
            status: 'idle',
            openCardIds: [],
            revision: 0
          }
        ],
        newSessionMode: 'plan'
      }
    })
    expect(listSessions.output.safeParse(result).success).toBe(true)
  })

  it('lists nothing for a profile without sessions or an unknown profile, and a new session starts with Ask', async () => {
    const { list } = setup()
    expect(await list({ profileId: 'w2' })).toEqual({ ok: true, value: { sessions: [], folders: [], newSessionMode: 'ask' } })
    expect(await list({ profileId: 'missing' })).toEqual({ ok: true, value: { sessions: [], folders: [], newSessionMode: 'ask' } })
  })

  it('gives the mode of the newest created session to a new session, and Ask after Approve all', async () => {
    const { insert, list } = setup()
    // The newest session is the second row in the table: only the creation time says so.
    insert.run('a', 'w1', 'A', 'a', 'auto', 'C:\\work', 'default', '[]', '2026-01-03')
    insert.run('b', 'w1', 'B', 'b', 'approve-all', 'C:\\work', 'default', '[]', '2026-01-01')
    insert.run('c', 'w2', 'C', 'c', 'plan', 'C:\\work', 'default', '[]', '2026-01-02')
    expect(await list({ profileId: 'w1' })).toMatchObject({ ok: true, value: { newSessionMode: 'auto' } })
    expect(await list({ profileId: 'w2' })).toMatchObject({ ok: true, value: { newSessionMode: 'plan' } })

    insert.run('d', 'w1', 'D', 'd', 'approve-all', 'C:\\work', 'default', '[]', '2026-01-04')
    const after = await list({ profileId: 'w1' })
    expect(after).toMatchObject({ ok: true, value: { newSessionMode: 'ask' } })
    expect(listSessions.output.safeParse(after).success).toBe(true)
  })

  it('throws on a row that breaks the schema, because the database is then damaged', async () => {
    const { database, list } = setup()
    // The CHECK of the table accepts any JSON array, so a damaged attachment reaches the reader.
    database
      .prepare(
        "INSERT INTO sessions (id, profile_id, title, prompt, mode, source_path, model, attachments, created_at) VALUES ('s1', 'w1', 't', 'p', 'ask', 'f', 'default', '[1]', '2026-01-01')"
      )
      .run()
    await expect(list({ profileId: 'w1' })).rejects.toThrow()
  })

  it('gives the unread mark of each session, from the saved column', async () => {
    const { store, insert, list } = setup()
    insert.run('s1', 'w1', 'First', 'p', 'ask', 'C:\\work', 'default', '[]', '2026-01-01')
    insert.run('s2', 'w1', 'Second', 'p', 'ask', 'C:\\work', 'default', '[]', '2026-01-02')
    store.setUnread('s2', true)
    const result = await list({ profileId: 'w1' })
    expect(result.ok && result.value.sessions.map((session) => [session.id, session.unread])).toEqual([['s1', false], ['s2', true]])
  })

  it('gives the live status, the open card IDs and the revision of the session events (S11-22)', async () => {
    const { insert, transcript, list } = setup()
    insert.run('s1', 'w1', 'First', 'p', 'ask', 'C:\\work', 'default', '[]', '2026-01-01')
    insert.run('s2', 'w1', 'Second', 'p', 'ask', 'C:\\work', 'default', '[]', '2026-01-02')
    transcript.setStatus('s1', 'working')
    transcript.openPermission('s1', { id: 'req-1', toolId: 'tool-1', title: 'npm test', toolKind: 'execute', locations: [], options: [] })
    const result = await list({ profileId: 'w1' })
    if (!result.ok) throw new Error('The list failed.')
    const [first, second] = result.value.sessions
    expect(first).toMatchObject({ id: 's1', status: 'working', openCardIds: ['req-1'], revision: 2 })
    expect(second).toMatchObject({ id: 's2', status: 'idle', openCardIds: [], revision: 0 })
  })

  it('lists the folders of the profile with the newest activity first, and the empty ones by the time that they were added', async () => {
    const { database, insert, list } = setup()
    const folder = database.prepare("INSERT INTO folders (id, profile_id, path, collapsed, created_at) VALUES (?, ?, ?, ?, ?)")
    folder.run('fa', 'w1', 'C:\\a', 0, '2026-01-01')
    folder.run('fb', 'w1', 'C:\\b', 1, '2026-01-02')
    folder.run('fc', 'w1', 'C:\\c', 0, '2026-01-05')
    folder.run('fo', 'w2', 'C:\\a', 0, '2026-01-09')
    insert.run('s1', 'w1', 'In a', 'p', 'ask', 'C:\\a', 'default', '[]', '2026-01-07')
    insert.run('s2', 'w1', 'In b', 'p', 'ask', 'C:\\b', 'default', '[]', '2026-01-03')
    const result = await list({ profileId: 'w1' })
    if (!result.ok) throw new Error('The list failed.')
    expect(result.value.folders).toEqual([
      { id: 'fa', path: 'C:\\a', collapsed: false },
      { id: 'fc', path: 'C:\\c', collapsed: false },
      { id: 'fb', path: 'C:\\b', collapsed: true }
    ])
  })

  it('refuses a live field in the saved session, and an unknown field in an item', () => {
    const item = {
      id: 's1',
      profileId: 'w1',
      title: 't',
      prompt: 'p',
      mode: 'ask',
      providerId: null,
      sourcePath: 'C:\\work',
      model: 'default',
      attachments: [],
      createdAt: '2026-01-01',
      unread: false,
      status: 'idle',
      openCardIds: [],
      revision: 0
    }
    expect(sessionItemSchema.safeParse(item).success).toBe(true)
    expect(sessionItemSchema.safeParse({ ...item, extra: 1 }).success).toBe(false)
    expect(sessionItemSchema.safeParse({ ...item, status: 'sleeping' }).success).toBe(false)
  })
})
