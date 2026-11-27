import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { openDatabase } from './database'
import { MIGRATIONS, orderMigrations } from './migrations'

/**
 * The SHA-256 of each migration, with LF line ends. A migration never changes after a release,
 * so a change of one of these files fails this test. A later change is a new file: add its hash.
 */
const HASHES: Record<number, string> = {
  1: '51676470525ed96ce90e5107854c7456f8ad6a9dbdb3fc71a4b8b72e39e91708',
  2: '5529b8a94e6395cf696ce17d525a5eba372719527f355d91eed13db144869bc0'
}

const hashOf = (sql: string) => createHash('sha256').update(sql.replaceAll('\r\n', '\n')).digest('hex')

describe('orderMigrations', () => {
  it('orders the files by their number', () => {
    const ordered = orderMigrations({
      '../database/migrations/002-b.sql': 'two',
      '../database/migrations/001-a.sql': 'one'
    })
    expect(ordered).toEqual([
      { version: 1, name: 'a', sql: 'one' },
      { version: 2, name: 'b', sql: 'two' }
    ])
  })

  it('refuses a gap, a repeat, a missing start and a bad name', () => {
    expect(() => orderMigrations({ '001-a.sql': '', '003-c.sql': '' })).toThrow(/without a gap/)
    expect(() => orderMigrations({ '001-a.sql': '', '001-b.sql': '' })).toThrow(/without a gap/)
    expect(() => orderMigrations({ '002-b.sql': '' })).toThrow(/without a gap/)
    expect(() => orderMigrations({ 'one.sql': '' })).toThrow(/NNN-name\.sql/)
  })
})

describe('the migrations of the product', () => {
  it('are ordered from 1', () => {
    expect(MIGRATIONS.length).toBeGreaterThan(0)
    expect(MIGRATIONS.map((migration) => migration.version)).toEqual(MIGRATIONS.map((_, index) => index + 1))
  })

  it('never change after their hash is recorded', () => {
    expect(Object.fromEntries(MIGRATIONS.map((migration) => [migration.version, hashOf(migration.sql)]))).toEqual(HASHES)
  })

  it('give a database that enforces its constraints', () => {
    const opened = openDatabase(':memory:', MIGRATIONS)
    if (!opened.ok) throw new Error(opened.error.message)
    const { database } = opened.value
    const insertProfile = database.prepare("INSERT INTO profiles (id, name, created_at) VALUES (?, ?, '2026-01-01')")
    insertProfile.run('p1', 'Personal')
    insertProfile.run('p2', 'Client')
    const insertProvider = database.prepare(
      "INSERT INTO providers (id, profile_id, kind, settings, created_at) VALUES (?, ?, ?, ?, '2026-01-01')"
    )
    insertProvider.run('v1', 'p1', 'claude-code', '{"configFolder":"claude"}')
    const insertSession = database.prepare(
      "INSERT INTO sessions (id, profile_id, provider_id, title, prompt, mode, source_path, model, created_at) VALUES (?, ?, ?, 't', 'p', ?, 'f', 'default', '2026-01-01')"
    )
    insertSession.run('s1', 'p1', 'v1', 'plan')
    insertSession.run('s2', 'p1', null, 'ask')

    // The mode, the foreign keys, the JSON and the unique kind of a profile. The code checks the kind, not the table.
    expect(() => insertSession.run('s3', 'p1', null, 'interactive')).toThrow()
    expect(() => insertSession.run('s4', 'missing', null, 'ask')).toThrow()
    expect(() => insertSession.run('s5', 'p1', 'missing', 'ask')).toThrow()
    expect(() => insertProvider.run('v3', 'p2', 'claude-code', 'not json')).toThrow()
    expect(() => insertProvider.run('v4', 'p2', 'claude-code', '[]')).toThrow()
    expect(() => insertProvider.run('v5', 'p1', 'claude-code', '{}')).toThrow()
    expect(() => database.prepare("INSERT INTO profiles (id, created_at) VALUES ('p3', '2026-01-01')").run()).toThrow()

    // Removing a profile removes its providers and its sessions, also a session that refers to a provider.
    database.prepare('DELETE FROM profiles WHERE id = ?').run('p1')
    expect(database.prepare('SELECT count(*) AS total FROM sessions').get()).toMatchObject({ total: 0 })
    expect(database.prepare('SELECT count(*) AS total FROM providers').get()).toMatchObject({ total: 0 })
    database.close()
  })

  it('version 2 keeps the snapshot and the agent session of a session, and the entries of its conversation', () => {
    const opened = openDatabase(':memory:', MIGRATIONS)
    if (!opened.ok) throw new Error(opened.error.message)
    const { database } = opened.value
    database.prepare("INSERT INTO profiles (id, name, created_at) VALUES ('p1', 'Personal', '2026-01-01')").run()
    database
      .prepare(
        "INSERT INTO sessions (id, profile_id, title, prompt, mode, source_path, model, created_at) VALUES ('s1', 'p1', 't', 'p', 'ask', 'f', 'default', '2026-01-01')"
      )
      .run()
    expect(database.prepare('SELECT provider_snapshot, agent_session_id FROM sessions').get()).toMatchObject({
      provider_snapshot: null,
      agent_session_id: null
    })
    const snapshot = database.prepare('UPDATE sessions SET provider_snapshot = ?, agent_session_id = ? WHERE id = ?')
    expect(() => snapshot.run('not json', 'a1', 's1')).toThrow()
    expect(() => snapshot.run('[]', 'a1', 's1')).toThrow()
    snapshot.run('{"configFolder":"claude"}', 'a1', 's1')

    const insertEntry = database.prepare(
      "INSERT INTO entries (id, session_id, position, kind, data, created_at) VALUES (?, ?, ?, 'user', ?, '2026-01-01')"
    )
    insertEntry.run('e1', 's1', 0, '{"kind":"user","text":"Say hello"}')
    expect(() => insertEntry.run('e2', 's1', 0, '{}')).toThrow() // The position is unique in a session.
    expect(() => insertEntry.run('e3', 's1', 1, 'not json')).toThrow()
    expect(() => insertEntry.run('e4', 's1', 1, '[]')).toThrow()
    expect(() => insertEntry.run('e5', 'missing', 0, '{}')).toThrow()

    // Removing a session removes its entries.
    database.prepare("DELETE FROM sessions WHERE id = 's1'").run()
    expect(database.prepare('SELECT count(*) AS total FROM entries').get()).toMatchObject({ total: 0 })
    database.close()
  })
})
