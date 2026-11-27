import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { listSessions } from './list.contract'
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
  return { database, insert, list: listSessionsController(database) }
}

describe('sessions.list', () => {
  it('lists the sessions of one profile, oldest first, with all their fields', async () => {
    const { insert, list } = setup()
    const attachments = JSON.stringify([{ kind: 'file', ref: 'C:\\notes.txt', label: 'notes.txt' }])
    insert.run('s2', 'w1', 'Second', 'Second prompt', 'plan', 'C:\\work', 'claude-opus-5-5', attachments, '2026-01-02')
    insert.run('s1', 'w1', 'First', 'First prompt', 'approve-all', 'C:\\work', 'default', '[]', '2026-01-01')
    insert.run('s3', 'w2', 'Other', 'Other prompt', 'ask', 'C:\\other', 'default', '[]', '2026-01-01')

    const result = await list({ profileId: 'w1' })
    expect(result).toEqual({
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
            createdAt: '2026-01-01'
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
            createdAt: '2026-01-02'
          }
        ],
        newSessionMode: 'plan'
      }
    })
    expect(listSessions.output.safeParse(result).success).toBe(true)
  })

  it('lists nothing for a profile without sessions or an unknown profile, and a new session starts with Ask', async () => {
    const { list } = setup()
    expect(await list({ profileId: 'w2' })).toEqual({ ok: true, value: { sessions: [], newSessionMode: 'ask' } })
    expect(await list({ profileId: 'missing' })).toEqual({ ok: true, value: { sessions: [], newSessionMode: 'ask' } })
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
})
