import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from './database'
import { MIGRATIONS, orderMigrations } from './migrations'

/**
 * The SHA-256 of each migration, with LF line ends. A migration never changes after a release,
 * so a change of one of these files fails this test. A later change is a new file: add its hash.
 */
const HASHES: Record<number, string> = {
  1: '51676470525ed96ce90e5107854c7456f8ad6a9dbdb3fc71a4b8b72e39e91708',
  2: 'bacb2a45fb0a1f4d5f0acf8e4ea0adbffd92344c26d266c935cf74e1e8b643ce',
  3: 'a283f8e1ea5bd771eae404bc687f4d0c7338d99a38eb812d70d66955d4101e15',
  4: '014b8186c16d97ad0d31d8aa5047d9cf103c800a757943f4f20aa0709fd9074b',
  5: '97e8f47d354d65f438441e5e66ddc96d502bb92bd52ecc667bdf02e48878d402',
  6: '320db5eb55cc6f41a92d26293b557e98c3ce06ee635b9fb33e34bb077bd71492'
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
    // A profile can have many accounts of one kind (decision 0014).
    insertProvider.run('v5', 'p1', 'claude-code', '{}')
    expect(() => database.prepare("INSERT INTO profiles (id, created_at) VALUES ('p3', '2026-01-01')").run()).toThrow()

    // Removing a profile removes its providers and its sessions, also a session that refers to a provider.
    database.prepare('DELETE FROM profiles WHERE id = ?').run('p1')
    expect(database.prepare('SELECT count(*) AS total FROM sessions').get()).toMatchObject({ total: 0 })
    expect(database.prepare('SELECT count(*) AS total FROM providers').get()).toMatchObject({ total: 0 })
    database.close()
  })

  it('version 2 keeps the agent runs of a session, and the entries of its conversation', () => {
    const opened = openDatabase(':memory:', MIGRATIONS)
    if (!opened.ok) throw new Error(opened.error.message)
    const { database } = opened.value
    database.prepare("INSERT INTO profiles (id, name, created_at) VALUES ('p1', 'Personal', '2026-01-01')").run()
    database
      .prepare(
        "INSERT INTO providers (id, profile_id, kind, label, settings, is_current, created_at) VALUES ('v1', 'p1', 'claude-code', 'Claude', '{}', 1, '2026-01-01')"
      )
      .run()
    database
      .prepare(
        "INSERT INTO sessions (id, profile_id, title, prompt, mode, source_path, model, created_at) VALUES ('s1', 'p1', 't', 'p', 'ask', 'f', 'default', '2026-01-01')"
      )
      .run()
    // The snapshot columns of the first draft of version 2 do not exist.
    expect(Object.keys(database.prepare('SELECT * FROM sessions').get() ?? {}).sort()).toEqual(
      ['attachments', 'created_at', 'id', 'mode', 'model', 'profile_id', 'prompt', 'provider_id', 'source_path', 'started_by', 'title', 'title_source', 'unread'].sort()
    )

    const insertRun = database.prepare(
      "INSERT INTO agent_sessions (id, session_id, provider_id, external_id, created_at) VALUES (?, ?, ?, ?, '2026-01-01')"
    )
    insertRun.run('r1', 's1', 'v1', 'a1')
    expect(() => insertRun.run('r2', 'missing', 'v1', 'a1')).toThrow()
    expect(() => insertRun.run('r3', 's1', 'missing', 'a1')).toThrow()
    expect(() => insertRun.run('r4', 's1', 'v1', null)).toThrow()
    // An account that a run used cannot be deleted. A run of a session can be more than one (a later milestone).
    expect(() => database.prepare("DELETE FROM providers WHERE id = 'v1'").run()).toThrow()
    insertRun.run('r5', 's1', 'v1', 'a2')

    // The Claude folder of an account that a run used cannot change. The label can.
    expect(() => database.prepare(`UPDATE providers SET settings = '{"configFolder":"C:/f2"}' WHERE id = 'v1'`).run()).toThrow(/cannot change/)
    database.prepare("UPDATE providers SET label = 'Work' WHERE id = 'v1'").run()

    const insertEntry = database.prepare(
      "INSERT INTO entries (id, session_id, position, kind, data, created_at) VALUES (?, ?, ?, 'user', ?, '2026-01-01')"
    )
    insertEntry.run('e1', 's1', 0, '{"kind":"user","text":"Say hello"}')
    expect(() => insertEntry.run('e2', 's1', 0, '{}')).toThrow() // The position is unique in a session.
    expect(() => insertEntry.run('e3', 's1', 1, 'not json')).toThrow()
    expect(() => insertEntry.run('e4', 's1', 1, '[]')).toThrow()
    expect(() => insertEntry.run('e5', 'missing', 0, '{"kind":"user"}')).toThrow()
    // The column `kind` equals the key `kind` of the JSON.
    expect(() => insertEntry.run('e6', 's1', 2, '{"kind":"agent","text":"x"}')).toThrow()
    expect(() => insertEntry.run('e7', 's1', 3, '{"text":"x"}')).toThrow()
    expect(() => database.prepare("UPDATE entries SET data = '{\"kind\":\"agent\"}' WHERE id = 'e1'").run()).toThrow()

    // Removing a session removes its entries and its agent runs. Removing the profile removes the rest.
    database.prepare("DELETE FROM sessions WHERE id = 's1'").run()
    expect(database.prepare('SELECT count(*) AS total FROM entries').get()).toMatchObject({ total: 0 })
    expect(database.prepare('SELECT count(*) AS total FROM agent_sessions').get()).toMatchObject({ total: 0 })
    database.prepare("DELETE FROM profiles WHERE id = 'p1'").run()
    expect(database.prepare('SELECT count(*) AS total FROM providers').get()).toMatchObject({ total: 0 })
    database.close()
  })

  it('version 2 allows many accounts of one kind in a profile, and one current account for each kind', () => {
    const opened = openDatabase(':memory:', MIGRATIONS)
    if (!opened.ok) throw new Error(opened.error.message)
    const { database } = opened.value
    database.prepare("INSERT INTO profiles (id, name, created_at) VALUES ('p1', 'Personal', '2026-01-01')").run()
    const insert = database.prepare(
      "INSERT INTO providers (id, profile_id, kind, settings, is_current, created_at) VALUES (?, 'p1', ?, '{}', ?, '2026-01-01')"
    )
    insert.run('v1', 'claude-code', 1)
    insert.run('v2', 'claude-code', 0)
    insert.run('v3', 'claude-code', 0)
    insert.run('v4', 'other-kind', 1)
    expect(() => insert.run('v5', 'claude-code', 1)).toThrow()
    expect(() => insert.run('v6', 'claude-code', 2)).toThrow()
    expect(database.prepare("SELECT label FROM providers WHERE id = 'v1'").get()).toEqual({ label: '' })
    database.close()
  })

  it('version 2 rebuilds the providers of a version 1 database and loses no row', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'aether-migration-'))
    try {
      const path = join(folder, 'aether.db')
      const first = openDatabase(path, MIGRATIONS.slice(0, 1))
      if (!first.ok) throw new Error(first.error.message)
      const old = first.value.database
      old.prepare("INSERT INTO profiles (id, name, created_at) VALUES ('p1', 'Personal', '2026-01-01')").run()
      old.prepare("INSERT INTO profiles (id, name, created_at) VALUES ('p2', 'Client', '2026-01-01')").run()
      const insertProvider = old.prepare("INSERT INTO providers (id, profile_id, kind, settings, created_at) VALUES (?, ?, 'claude-code', ?, ?)")
      insertProvider.run('v1', 'p1', '{"configFolder":"C:/f1","profileName":"work"}', '2026-01-02')
      insertProvider.run('v2', 'p2', '{}', '2026-01-03')
      const insertSession = old.prepare(
        "INSERT INTO sessions (id, profile_id, provider_id, title, prompt, mode, source_path, model, created_at) VALUES (?, ?, ?, 't', 'p', 'ask', 'f', 'default', '2026-01-04')"
      )
      insertSession.run('s1', 'p1', 'v1')
      insertSession.run('s2', 'p1', null)
      old.close()

      const second = openDatabase(path, MIGRATIONS.slice(0, 2))
      if (!second.ok) throw new Error(second.error.message)
      const { database } = second.value
      // No row is lost. Each account keeps its values, gets an empty label, and is the current one of its profile.
      expect(database.prepare('SELECT id, profile_id, kind, label, settings, is_current, created_at FROM providers ORDER BY id').all()).toEqual([
        { id: 'v1', profile_id: 'p1', kind: 'claude-code', label: '', settings: '{"configFolder":"C:/f1","profileName":"work"}', is_current: 1, created_at: '2026-01-02' },
        { id: 'v2', profile_id: 'p2', kind: 'claude-code', label: '', settings: '{}', is_current: 1, created_at: '2026-01-03' }
      ])
      expect(database.prepare('SELECT id, provider_id FROM sessions ORDER BY id').all()).toEqual([
        { id: 's1', provider_id: 'v1' },
        { id: 's2', provider_id: null }
      ])
      // The key of the sessions still names the new table: a provider that a session uses cannot be deleted.
      expect(database.prepare('PRAGMA foreign_key_list(sessions)').all().map((row) => row.table).sort()).toEqual(['profiles', 'providers'])
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(() => database.prepare("DELETE FROM providers WHERE id = 'v1'").run()).toThrow()
      expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 2 })
      database.close()
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })
  it('version 3 adds the trust answers and the allowed directories of a profile, and removes them with the profile', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'aether-migration-'))
    try {
      const path = join(folder, 'aether.db')
      const first = openDatabase(path, MIGRATIONS.slice(0, 2))
      if (!first.ok) throw new Error(first.error.message)
      first.value.database.prepare("INSERT INTO profiles (id, name, created_at) VALUES ('p1', 'Personal', '2026-01-01')").run()
      first.value.database.close()

      const second = openDatabase(path, MIGRATIONS.slice(0, 3))
      if (!second.ok) throw new Error(second.error.message)
      const { database } = second.value
      expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 3 })
      for (const table of ['trusted_repositories', 'allowed_directories']) {
        database.prepare(`INSERT INTO ${table} (profile_id, path, created_at) VALUES ('p1', 'c:/workspace/repo-b', '2026-01-02')`).run()
        // One answer for one folder and profile, and a profile that exists.
        expect(() => database.prepare(`INSERT INTO ${table} (profile_id, path, created_at) VALUES ('p1', 'c:/workspace/repo-b', '2026-01-03')`).run()).toThrow()
        expect(() => database.prepare(`INSERT INTO ${table} (profile_id, path, created_at) VALUES ('nobody', 'c:/x', '2026-01-03')`).run()).toThrow()
      }
      database.prepare("DELETE FROM profiles WHERE id = 'p1'").run()
      expect(database.prepare('SELECT count(*) AS total FROM trusted_repositories').get()).toEqual({ total: 0 })
      expect(database.prepare('SELECT count(*) AS total FROM allowed_directories').get()).toEqual({ total: 0 })
      database.close()
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })

  it('version 4 gives each earlier session the starter `person`, and a new row too', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'aether-migration-'))
    try {
      const path = join(folder, 'aether.db')
      const first = openDatabase(path, MIGRATIONS.slice(0, 3))
      if (!first.ok) throw new Error(first.error.message)
      first.value.database.prepare("INSERT INTO profiles (id, name, created_at) VALUES ('p1', 'Personal', '2026-01-01')").run()
      first.value.database
        .prepare("INSERT INTO sessions (id, profile_id, title, prompt, mode, source_path, model, created_at) VALUES ('s1', 'p1', 't', 'p', 'ask', 'f', 'default', '2026-01-02')")
        .run()
      first.value.database.close()

      const second = openDatabase(path, MIGRATIONS.slice(0, 4))
      if (!second.ok) throw new Error(second.error.message)
      const { database } = second.value
      expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 4 })
      database
        .prepare("INSERT INTO sessions (id, profile_id, title, prompt, mode, source_path, model, created_at) VALUES ('s2', 'p1', 't', 'p', 'ask', 'f', 'default', '2026-01-03')")
        .run()
      expect(database.prepare('SELECT id, started_by FROM sessions ORDER BY id').all()).toEqual([
        { id: 's1', started_by: 'person' },
        { id: 's2', started_by: 'person' }
      ])
      // No CHECK lists the values: the code validates them (user preference 5).
      database.prepare("UPDATE sessions SET started_by = 'automation' WHERE id = 's2'").run()
      expect(database.prepare("SELECT started_by FROM sessions WHERE id = 's2'").get()).toEqual({ started_by: 'automation' })
      database.close()
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })
})
