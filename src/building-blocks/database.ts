import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
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

/**
 * Opens the file, turns foreign keys on and reads the header, where `user_version` lives. A file
 * that is not a database fails here. The caller then checks the version, and only after that the
 * schema: a newer database must be refused even when this SQLite cannot parse its schema.
 */
function connect(path: string): { sqlite: DatabaseSync; version: number } {
  const sqlite = new DatabaseSync(path)
  try {
    sqlite.exec('PRAGMA foreign_keys = ON')
    return { sqlite, version: versionOf(sqlite) }
  } catch (cause) {
    sqlite.close()
    throw cause
  }
}

/** Reads the schema. A file with a good header and a damaged schema fails here. */
function readSchema(sqlite: DatabaseSync): void {
  try {
    sqlite.prepare('SELECT count(*) FROM sqlite_master').get()
  } catch (cause) {
    sqlite.close()
    throw cause
  }
}

/**
 * Connects, and reads the schema when the version is not newer than `latest`.
 * A newer version returns before the schema read, so that the caller can refuse it.
 */
function attempt(path: string, latest: number): { sqlite: DatabaseSync; version: number } {
  const connected = connect(path)
  if (connected.version <= latest) readSchema(connected.sqlite)
  return connected
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

/**
 * Runs one migration and sets `user_version` in the same transaction.
 *
 * Foreign keys are off during the migration, and the pragma works only outside a transaction.
 * A migration that rebuilds a table then does not delete the rows of the tables that refer to it
 * through `ON DELETE CASCADE`. Before the commit, `foreign_key_check` must report no row.
 */
function apply(sqlite: DatabaseSync, migration: Migration): void {
  sqlite.exec('PRAGMA foreign_keys = OFF')
  try {
    sqlite.exec('BEGIN IMMEDIATE')
    try {
      sqlite.exec(migration.sql)
      const broken = sqlite.prepare('PRAGMA foreign_key_check').all()
      if (broken.length > 0) {
        throw new Error(`The migration ${migration.version} leaves ${broken.length} rows that break a foreign key.`)
      }
      sqlite.exec(`PRAGMA user_version = ${Math.trunc(migration.version)}`)
      sqlite.exec('COMMIT')
    } catch (cause) {
      if (sqlite.isTransaction) sqlite.exec('ROLLBACK')
      throw cause
    }
  } finally {
    sqlite.exec('PRAGMA foreign_keys = ON')
  }
}

/** The files that SQLite keeps next to a database file. */
const COMPANIONS = ['-journal', '-wal', '-shm']

/**
 * Reads the companion files before the first open. SQLite deletes a journal that it cannot use,
 * and it deletes the wal and shm files when it closes, also for a file that is not a database.
 */
function readCompanions(path: string): Map<string, Buffer> {
  const found = new Map<string, Buffer>()
  for (const suffix of COMPANIONS) {
    if (existsSync(path + suffix)) found.set(suffix, readFileSync(path + suffix))
  }
  return found
}

/**
 * Renames the unreadable file, and keeps its companions next to it, so that Aether loses none
 * of the bytes. The new database starts without them.
 */
function moveAside(path: string, target: string, companions: Map<string, Buffer>): void {
  renameSync(path, target)
  for (const suffix of COMPANIONS) {
    rmSync(path + suffix, { force: true })
    const bytes = companions.get(suffix)
    if (bytes) writeFileSync(target + suffix, bytes)
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
  const latest = migrations.at(-1)?.version ?? 0
  let connected: { sqlite: DatabaseSync; version: number }
  let keptAside: string | null = null
  const companions = inMemory ? new Map<string, Buffer>() : readCompanions(path)
  try {
    try {
      connected = attempt(path, latest)
    } catch (cause) {
      if (inMemory || !isUnreadable(cause)) throw cause
      keptAside = freePath(path, 'unreadable', now())
      moveAside(path, keptAside, companions)
      connected = attempt(path, latest)
    }
  } catch (cause) {
    return err('database-failed', `Aether could not open its database. ${describe(cause)}`)
  }

  let { sqlite } = connected
  const from = connected.version
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
      const copy = freePath(path, `before-version-${from}`, now())
      try {
        copyFileSync(path, copy)
      } catch (cause) {
        // A partial copy is not a backup. The original file is untouched.
        rmSync(copy, { force: true })
        throw cause
      }
      backup = copy
      sqlite = attempt(path, latest).sqlite
    }
    for (const migration of pending) apply(sqlite, migration)
  } catch (cause) {
    if (sqlite.isOpen) sqlite.close()
    if (backup) {
      try {
        copyFileSync(backup, path)
      } catch (restore) {
        return err(
          'database-failed',
          `Aether could not update its database, and could not restore the copy ${backup}. ${describe(cause)} ${describe(restore)}`
        )
      }
    }
    return err('database-failed', `Aether could not update its database. ${describe(cause)}`)
  }
  return ok({ database: new SqliteDatabase(sqlite), keptAside })
}
