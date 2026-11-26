import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { openDatabase } from './database'
import { MIGRATIONS, orderMigrations } from './migrations'

/**
 * The SHA-256 of each migration, with LF line ends. A migration never changes after a release,
 * so a change of one of these files fails this test. A later change is a new file: add its hash.
 */
const HASHES: Record<number, string> = {
  1: '12a45b061bd02fb9912d0fdb892e1edf349f923da997183a30b06ef05faa773a'
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
    const insertWorkspace = database.prepare("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, '2026-01-01')")
    insertWorkspace.run('w1', 'Personal')
    const insertSession = database.prepare(
      "INSERT INTO sessions (id, workspace_id, title, prompt, mode, folder, model, created_at) VALUES (?, ?, 't', 'p', ?, 'f', 'default', '2026-01-01')"
    )
    insertSession.run('s1', 'w1', 'plan')
    expect(() => insertSession.run('s2', 'w1', 'interactive')).toThrow()
    expect(() => insertSession.run('s3', 'missing', 'ask')).toThrow()
    expect(() => insertWorkspace.run('w2', '  ')).toThrow()
    expect(() =>
      database.prepare("INSERT INTO workspaces (id, name, github_name, created_at) VALUES ('w3', 'X', 'Name', '2026-01-01')").run()
    ).toThrow()

    // Removing a workspace removes its sessions.
    database.prepare('DELETE FROM workspaces WHERE id = ?').run('w1')
    expect(database.prepare('SELECT count(*) AS total FROM sessions').get()).toMatchObject({ total: 0 })
    database.close()
  })
})
