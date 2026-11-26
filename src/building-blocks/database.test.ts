import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from './database'
import type { Migration } from './migrations'

let folder: string
let path: string
const now = () => new Date('2026-01-02T03:04:05.678Z')

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'aether-db-'))
  path = join(folder, 'aether.db')
})

afterEach(() => rm(folder, { recursive: true, force: true }))

const first: Migration = { version: 1, name: 'one', sql: 'CREATE TABLE one (id INTEGER PRIMARY KEY, note TEXT);' }
const second: Migration = { version: 2, name: 'two', sql: 'CREATE TABLE two (id INTEGER PRIMARY KEY);' }
const broken: Migration = {
  version: 2,
  name: 'broken',
  sql: "INSERT INTO one (note) VALUES ('half'); CREATE TABLE one (id INTEGER);"
}

function opened(migrations: Migration[], where = path) {
  const result = openDatabase(where, migrations, now)
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  return result.value
}

const names = async () => (await readdir(folder)).sort()

describe('openDatabase', () => {
  it('creates a database at the newest version, with foreign keys on', () => {
    const { database, keptAside } = opened([first, second])
    expect(keptAside).toBeNull()
    expect(database.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 2 })
    expect(database.prepare('PRAGMA foreign_keys').get()).toMatchObject({ foreign_keys: 1 })
    database.close()
  })

  it('opens an in-memory database', () => {
    const { database } = opened([first], ':memory:')
    expect(database.prepare('SELECT count(*) AS total FROM one').get()).toMatchObject({ total: 0 })
    database.close()
  })

  it('makes no copy for a new database', async () => {
    opened([first]).database.close()
    expect(await names()).toEqual(['aether.db'])
  })

  it('runs only the pending migrations, after a copy of the file', async () => {
    const old = opened([first]).database
    old.prepare('INSERT INTO one (note) VALUES (?)').run('kept')
    old.close()
    const before = await readFile(path)

    const { database } = opened([first, second])
    expect(database.prepare('SELECT note FROM one').all()).toEqual([{ note: 'kept' }])
    expect(database.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 2 })
    database.close()

    const copies = (await names()).filter((name) => name !== 'aether.db')
    expect(copies).toEqual(['aether.db.before-version-1-20260102030405678'])
    expect((await readFile(join(folder, copies[0]!))).equals(before)).toBe(true)
  })

  it('opens a database at the newest version without a copy', async () => {
    opened([first, second]).database.close()
    opened([first, second]).database.close()
    expect(await names()).toEqual(['aether.db'])
  })

  it('rolls back a failed migration, restores the copy and reports the failure', async () => {
    const old = opened([first]).database
    old.prepare('INSERT INTO one (note) VALUES (?)').run('kept')
    old.close()
    const before = await readFile(path)

    const result = openDatabase(path, [first, broken], now)
    expect(result).toMatchObject({ ok: false, error: { code: 'database-failed' } })
    expect((await readFile(path)).equals(before)).toBe(true)

    // The file still opens at its old version, and a fixed migration then succeeds.
    const { database } = opened([first, second])
    expect(database.prepare('SELECT note FROM one').all()).toEqual([{ note: 'kept' }])
    database.close()
  })

  it('refuses a database with a newer version and leaves it as it is', async () => {
    opened([first, second]).database.close()
    const before = await readFile(path)

    const result = openDatabase(path, [first], now)
    expect(result).toMatchObject({ ok: false, error: { code: 'database-newer' } })
    expect((await readFile(path)).equals(before)).toBe(true)
    expect(await names()).toEqual(['aether.db'])
  })

  it('keeps a file that is not a database, and starts a new database', async () => {
    const text = Buffer.from('This is not a SQLite database.\r\n'.repeat(64))
    await writeFile(path, text)

    const { database, keptAside } = opened([first])
    expect(keptAside).toBe(`${path}.unreadable-20260102030405678`)
    expect((await readFile(keptAside!)).equals(text)).toBe(true)
    expect(database.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 1 })
    database.close()
  })

  it('keeps a file that has a good header and a damaged schema, and starts a new database', async () => {
    opened([first]).database.close()
    // The first 100 bytes are the header of the database, and `user_version` is in them.
    // The schema (`sqlite_master`) follows in the same page. Damage everything after the header.
    const good = await readFile(path)
    const damaged = Buffer.concat([good.subarray(0, 100), Buffer.alloc(good.length - 100, 0xff)])
    await writeFile(path, damaged)

    const { database, keptAside } = opened([first])
    expect(keptAside).toBe(`${path}.unreadable-20260102030405678`)
    expect((await readFile(keptAside!)).equals(damaged)).toBe(true)
    expect(database.prepare('SELECT count(*) AS total FROM one').get()).toMatchObject({ total: 0 })
    database.close()
  })

  it('moves the journal, the wal and the shm file of an unreadable database with it', async () => {
    const text = Buffer.from('This is not a SQLite database. '.repeat(64))
    await writeFile(path, text)
    const suffixes = ['-journal', '-wal', '-shm']
    for (const suffix of suffixes) await writeFile(path + suffix, `old ${suffix}`)

    const { database, keptAside } = opened([first])
    database.close()
    expect((await readFile(keptAside!)).equals(text)).toBe(true)
    for (const suffix of suffixes) expect(await readFile(keptAside! + suffix, 'utf8')).toBe(`old ${suffix}`)
    // The new database starts without the old companions.
    expect((await names()).filter((name) => name.startsWith('aether.db-'))).toEqual([])
  })

  it('gives each kept file its own name', async () => {
    await writeFile(path, 'not a database, first')
    opened([first]).database.close()
    // The new database is removed so that a second unreadable file takes its place.
    await rm(path)
    await writeFile(path, 'not a database, second')
    opened([first]).database.close()
    expect((await names()).filter((name) => name.includes('unreadable'))).toEqual([
      'aether.db.unreadable-20260102030405678',
      'aether.db.unreadable-20260102030405678-1'
    ])
  })

  it('reports a failure that is not an unreadable file, and keeps the file', async () => {
    // A folder at the path of the file: SQLite cannot open it, and the file is not unreadable.
    const result = openDatabase(folder, [first], now)
    expect(result).toMatchObject({ ok: false, error: { code: 'database-failed' } })
    expect(await names()).toEqual([])
  })
})

describe('openDatabase: newer version', () => {
  it('refuses a newer version before it reads the schema, also when the schema is damaged', async () => {
    const plain = new DatabaseSync(path)
    plain.exec('CREATE TABLE future (id INTEGER PRIMARY KEY, note TEXT); PRAGMA user_version = 7')
    plain.close()
    const good = await readFile(path)
    // Keep the header, where `user_version` is. Damage the page of the schema.
    const damaged = Buffer.concat([good.subarray(0, 100), Buffer.alloc(good.length - 100, 0xff)])
    await writeFile(path, damaged)

    const result = openDatabase(path, [first], now)
    expect(result).toMatchObject({ ok: false, error: { code: 'database-newer' } })
    expect((await readFile(path)).equals(damaged)).toBe(true)
    expect(await names()).toEqual(['aether.db'])
  })
})

describe('openDatabase: foreign keys in a migration', () => {
  const parentAndChild: Migration = {
    version: 1,
    name: 'parent-and-child',
    sql: `CREATE TABLE parent (id TEXT PRIMARY KEY, name TEXT NOT NULL);
          CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parent (id) ON DELETE CASCADE);`
  }
  const rebuild: Migration = {
    version: 2,
    name: 'rebuild-parent',
    sql: `CREATE TABLE parent_new (id TEXT PRIMARY KEY, name TEXT NOT NULL, note TEXT);
          INSERT INTO parent_new (id, name) SELECT id, name FROM parent;
          DROP TABLE parent;
          ALTER TABLE parent_new RENAME TO parent;`
  }
  const orphan: Migration = {
    version: 2,
    name: 'orphan',
    sql: "DELETE FROM parent WHERE id = 'p1';"
  }

  function seeded() {
    const old = opened([parentAndChild]).database
    old.prepare('INSERT INTO parent (id, name) VALUES (?, ?)').run('p1', 'One')
    old.prepare('INSERT INTO child (id, parent_id) VALUES (?, ?)').run('c1', 'p1')
    old.close()
  }

  it('keeps the child rows when a migration rebuilds the parent table', () => {
    seeded()
    const { database } = opened([parentAndChild, rebuild])
    expect(database.prepare('SELECT id FROM child').all()).toEqual([{ id: 'c1' }])
    expect(database.prepare('SELECT id, name FROM parent').all()).toEqual([{ id: 'p1', name: 'One' }])
    // Foreign keys are on again after the migration.
    expect(database.prepare('PRAGMA foreign_keys').get()).toMatchObject({ foreign_keys: 1 })
    expect(() => database.prepare('INSERT INTO child (id, parent_id) VALUES (?, ?)').run('c2', 'missing')).toThrow()
    database.close()
  })

  it('fails a migration that leaves a row that breaks a foreign key, and restores the copy', async () => {
    seeded()
    const before = await readFile(path)
    const result = openDatabase(path, [parentAndChild, orphan], now)
    expect(result).toMatchObject({ ok: false, error: { code: 'database-failed' } })
    expect((await readFile(path)).equals(before)).toBe(true)
  })
})

describe('Database.transaction', () => {
  const fresh = () => opened([first], ':memory:').database
  const total = (database: ReturnType<typeof fresh>) =>
    Number(database.prepare('SELECT count(*) AS total FROM one').get()?.total)

  it('commits the changes of the work and returns its value', () => {
    const database = fresh()
    const value = database.transaction(() => {
      database.prepare('INSERT INTO one (note) VALUES (?)').run('a')
      return 'done'
    })
    expect(value).toBe('done')
    expect(total(database)).toBe(1)
  })

  it('rolls back all changes when the work throws', () => {
    const database = fresh()
    expect(() =>
      database.transaction(() => {
        database.prepare('INSERT INTO one (note) VALUES (?)').run('a')
        throw new Error('stop')
      })
    ).toThrow('stop')
    expect(total(database)).toBe(0)
  })

  it('joins a transaction inside a transaction, and rolls both back together', () => {
    const database = fresh()
    expect(() =>
      database.transaction(() => {
        database.transaction(() => database.prepare('INSERT INTO one (note) VALUES (?)').run('inner'))
        throw new Error('outer')
      })
    ).toThrow('outer')
    expect(total(database)).toBe(0)
    // The next transaction starts clean.
    database.transaction(() => database.prepare('INSERT INTO one (note) VALUES (?)').run('b'))
    expect(total(database)).toBe(1)
  })
})

it('opens with the plain node:sqlite API, so that a test can read the file', async () => {
  opened([first]).database.close()
  const plain = new DatabaseSync(path)
  expect(plain.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 1 })
  plain.close()
})
