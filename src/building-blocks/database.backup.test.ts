import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Fs from 'node:fs'
import type { Migration } from './migrations'

// The copy before a migration needs a failure that a test cannot make with a real disk.
// This file replaces `copyFileSync` by a function that a test controls. The other tests use the real one.
const control = vi.hoisted(() => ({ copy: null as null | ((from: string, to: string) => void) }))

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof Fs>()
  return {
    ...real,
    default: real,
    copyFileSync: (from: string, to: string) => (control.copy ? control.copy(from, to) : real.copyFileSync(from, to))
  }
})

const { openDatabase } = await import('./database')
const { copyFileSync, writeFileSync } = await vi.importActual<typeof Fs>('node:fs')

let folder: string
let path: string
const now = () => new Date('2026-01-02T03:04:05.678Z')

const first: Migration = { version: 1, name: 'one', sql: 'CREATE TABLE one (id INTEGER PRIMARY KEY, note TEXT);' }
const second: Migration = { version: 2, name: 'two', sql: 'CREATE TABLE two (id INTEGER PRIMARY KEY);' }
const broken: Migration = { version: 2, name: 'broken', sql: 'CREATE TABLE one (id INTEGER);' }

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'aether-db-backup-'))
  path = join(folder, 'aether.db')
  control.copy = null
  const opened = openDatabase(path, [first], now)
  if (!opened.ok) throw new Error(opened.error.message)
  opened.value.database.prepare('INSERT INTO one (note) VALUES (?)').run('kept')
  opened.value.database.close()
})

afterEach(() => rm(folder, { recursive: true, force: true }))

const names = async () => (await readdir(folder)).sort()
const diskFull = () => Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })

describe('the copy before a migration', () => {
  it('leaves the database as it is when the copy fails half way, and removes the partial copy', async () => {
    const before = await readFile(path)
    control.copy = (_from, to) => {
      writeFileSync(to, Buffer.alloc(100))
      throw diskFull()
    }
    expect(openDatabase(path, [first, second], now)).toMatchObject({ ok: false, error: { code: 'database-failed' } })
    expect((await readFile(path)).equals(before)).toBe(true)
    expect(await names()).toEqual(['aether.db'])
  })

  it('returns a result, and does not throw, when the copy fails and leaves no file', async () => {
    const before = await readFile(path)
    control.copy = () => {
      throw diskFull()
    }
    expect(openDatabase(path, [first, second], now)).toMatchObject({ ok: false, error: { code: 'database-failed' } })
    expect((await readFile(path)).equals(before)).toBe(true)
    expect(await names()).toEqual(['aether.db'])
  })

  it('returns a result, and does not throw, when the restore fails after a failed migration', async () => {
    let calls = 0
    control.copy = (from, to) => {
      calls += 1
      // The first call is the copy before the migration. The second is the restore.
      if (calls === 2) throw diskFull()
      copyFileSync(from, to)
    }
    const result = openDatabase(path, [first, broken], now)
    expect(result).toMatchObject({ ok: false, error: { code: 'database-failed', message: expect.stringContaining('restore') } })
    // The copy is kept, so that the user can restore it by hand.
    expect(await names()).toEqual(['aether.db', 'aether.db.before-version-1-20260102030405678'])
  })

  it('restores the copy when a migration fails and the copy is good', async () => {
    const before = await readFile(path)
    expect(openDatabase(path, [first, broken], now)).toMatchObject({ ok: false, error: { code: 'database-failed' } })
    expect((await readFile(path)).equals(before)).toBe(true)
  })
})
