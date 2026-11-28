import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { SessionStore } from '../session.store'
import { deleteSession } from './delete.contract'
import { deleteSessionController } from './delete.controller'

function setup() {
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  const { database } = opened.value
  database.prepare("INSERT INTO profiles (id, name, created_at) VALUES ('w1', 'Personal', '2026-01-01')").run()
  const insert = database.prepare(
    "INSERT INTO sessions (id, profile_id, title, prompt, mode, source_path, model, created_at) VALUES (?, 'w1', ?, ?, 'ask', 'f', 'default', '2026-01-01')"
  )
  insert.run('s1', 'First', 'First')
  insert.run('s2', 'Second', 'Second')
  const released: string[] = []
  const release = async (id: string) => {
    released.push(id)
  }
  return { remove: deleteSessionController(database, release), store: new SessionStore(database), database, released }
}

describe('sessions.delete', () => {
  it('deletes the row of the session and keeps the others and the profile', async () => {
    const { remove, store, database } = setup()
    const result = await remove({ id: 's1' })
    expect(result).toEqual({ ok: true, value: {} })
    expect(deleteSession.output.safeParse(result).success).toBe(true)
    expect(store.listByProfile('w1').map((session) => session.id)).toEqual(['s2'])
    expect(database.prepare('SELECT count(*) AS total FROM profiles').get()).toMatchObject({ total: 1 })
  })

  it('releases the agent process of the deleted session, and only of that session', async () => {
    const { remove, released } = setup()
    await remove({ id: 'missing' })
    expect(released).toEqual([])
    await remove({ id: 's1' })
    expect(released).toEqual(['s1'])
  })

  it('deletes the entries of the session with it', async () => {
    const { remove, store, database } = setup()
    store.insertEntry('s1', { id: 'e1', entry: { kind: 'user', text: 'First' } }, 0, '2026-01-02')
    store.insertEntry('s2', { id: 'e2', entry: { kind: 'user', text: 'Second' } }, 0, '2026-01-02')
    await remove({ id: 's1' })
    expect(database.prepare('SELECT id FROM entries').all()).toEqual([{ id: 'e2' }])
  })

  it('refuses a session that does not exist, also a second delete of the same session', async () => {
    const { remove, store } = setup()
    expect(await remove({ id: 'missing' })).toMatchObject({ ok: false, error: { code: 'unknown-session' } })
    await remove({ id: 's1' })
    const again = await remove({ id: 's1' })
    expect(again).toMatchObject({ ok: false, error: { code: 'unknown-session' } })
    expect(deleteSession.output.safeParse(again).success).toBe(true)
    expect(store.listByProfile('w1')).toHaveLength(1)
  })
})
