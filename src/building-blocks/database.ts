import { copyFileSync, existsSync, renameSync } from 'node:fs'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type { Migration } from './migrations'
import { err, ok, type Result } from './result'

/** The boundary to SQLite. A store runs its statements through this interface. */
export interface Database {
  prepare(sql: string): StatementSync
  exec(sql: string): void
  /**
   * Runs `work` as one transaction. It commits when `work` returns and rolls back when it throws.
   * A call inside a transaction joins the outer one.
   */
  transaction<Value>(work: () => Value): Value
  close(): void
}

/** Why the database cannot open: a newer version, or a failure that Aether cannot repair. */
export type OpenError = 'database-newer' | 'database-failed'

export interface Opened {
  database: Database
  /** The path of the unreadable file that Aether kept aside, or null when the file was readable. */
  keptAside: string | null
}

const MEMORY = ':memory:'

/** SQLite result codes: SQLITE_CORRUPT and SQLITE_NOTADB. The low byte is the primary code. */
const UNREADABLE_CODES = [11, 26]

function isUnreadable(cause: unknown): boolean {
  const { code, errcode } = cause as { code?: unknown; errcode?: unknown }
  return code === 'ERR_SQLITE_ERROR' && typeof errcode === 'number' && UNREADABLE_CODES.includes(errcode & 0xff)
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function stampOf(now: Date): string {
  return now.toISOString().replace(/\D/g, '')
}

/** A path next to `path` that does not exist yet. */
function freePath(path: string, label: string, now: Date): string {
  const base = `${path}.${label}-${stampOf(now)}`
  for (let attempt = 0; ; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt}`
    if (!existsSync(candidate)) return candidate
  }
}

/** Opens the file, turns foreign keys on and reads one value. A file that is not a database fails here. */
function connect(path: string): DatabaseSync {
  const sqlite = new DatabaseSync(path)
  try {
    sqlite.exec('PRAGMA foreign_keys = ON')
    sqlite.prepare('PRAGMA user_version').get()
    return sqlite
  } catch (cause) {
    sqlite.close()
    throw cause
  }
}

const versionOf = (sqlite: DatabaseSync): number => Number(sqlite.prepare('PRAGMA user_version').get()?.user_version ?? 0)

const hasObjects = (sqlite: DatabaseSync): boolean =>
  Number(sqlite.prepare('SELECT count(*) AS total FROM sqlite_master').get()?.total ?? 0) > 0

class SqliteDatabase implements Database {
  private depth = 0

  constructor(private readonly sqlite: DatabaseSync) {}

  prepare(sql: string): StatementSync {
    return this.sqlite.prepare(sql)
  }

  exec(sql: string): void {
    this.sqlite.exec(sql)
  }

  transaction<Value>(work: () => Value): Value {
    if (this.depth > 0) return work()
    this.sqlite.exec('BEGIN IMMEDIATE')
    this.depth = 1
    try {
      const value = work()
      this.sqlite.exec('COMMIT')
      return value
    } catch (cause) {
      if (this.sqlite.isTransaction) this.sqlite.exec('ROLLBACK')
      throw cause
    } finally {
      this.depth = 0
    }
  }

  close(): void {
    this.sqlite.close()
  }
}

/** Runs one migration and sets `user_version` in the same transaction. */
function apply(sqlite: DatabaseSync, migration: Migration): void {
  sqlite.exec('BEGIN IMMEDIATE')
  try {
    sqlite.exec(migration.sql)
    sqlite.exec(`PRAGMA user_version = ${Math.trunc(migration.version)}`)
    sqlite.exec('COMMIT')
  } catch (cause) {
    if (sqlite.isTransaction) sqlite.exec('ROLLBACK')
    throw cause
  }
}

/**
 * Opens the database and brings it to the newest version (decision 0003).
 *
 * - A file that SQLite cannot read (not a database, or corrupt) is renamed and kept. Aether then
 *   starts a new database. Aether never overwrites the unreadable file.
 * - A database with a newer version is refused. Aether does not touch it.
 * - Before a migration of a database with data, Aether copies the file. It restores the copy
 *   when a migration fails. Each migration runs in one transaction.
 * - Any other failure returns `database-failed`.
 *
 * @param path The database file, or `:memory:` for a test.
 */
export function openDatabase(
  path: string,
  migrations: readonly Migration[],
  now: () => Date = () => new Date()
): Result<Opened, OpenError> {
  const inMemory = path === MEMORY
  let sqlite: DatabaseSync
  let keptAside: string | null = null
  try {
    try {
      sqlite = connect(path)
    } catch (cause) {
      if (inMemory || !isUnreadable(cause)) throw cause
      keptAside = freePath(path, 'unreadable', now())
      renameSync(path, keptAside)
      sqlite = connect(path)
    }
  } catch (cause) {
    return err('database-failed', `Aether could not open its database. ${describe(cause)}`)
  }

  const latest = migrations.at(-1)?.version ?? 0
  const from = versionOf(sqlite)
  if (from > latest) {
    sqlite.close()
    return err('database-newer', `The database has version ${from}. This Aether knows version ${latest}. Update Aether.`)
  }

  const pending = migrations.filter((migration) => migration.version > from)
  let backup: string | null = null
  try {
    if (pending.length > 0 && !inMemory && hasObjects(sqlite)) {
      // The copy needs a closed file, so that it holds each change.
      sqlite.close()
      backup = freePath(path, `before-version-${from}`, now())
      copyFileSync(path, backup)
      sqlite = connect(path)
    }
    for (const migration of pending) apply(sqlite, migration)
  } catch (cause) {
    if (sqlite.isOpen) sqlite.close()
    if (backup) copyFileSync(backup, path)
    return err('database-failed', `Aether could not update its database. ${describe(cause)}`)
  }
  return ok({ database: new SqliteDatabase(sqlite), keptAside })
}
