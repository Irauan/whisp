import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Clock } from '../../../building-blocks/clock.port'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { FolderStore } from '../folders.store'
import { addFolder } from './add.contract'
import { addFolderController } from './add.controller'

let base: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'aether-folders-add-'))
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

function setup() {
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  const { database } = opened.value
  database.prepare("INSERT INTO profiles (id, name, created_at) VALUES ('p1', 'Personal', '2026-01-01')").run()
  let next = 0
  const clock: Clock = { now: () => new Date('2026-02-01T00:00:00.000Z') }
  const add = addFolderController(database, clock, { next: () => `f${(next += 1)}` })
  return { add, store: new FolderStore(database) }
}

describe('folders.add', () => {
  it('adds an expanded folder for the profile and keeps its path', async () => {
    const { add, store } = setup()
    const folder = join(base, 'notes')
    mkdirSync(folder)
    const result = await add({ profileId: 'p1', path: folder })
    expect(result).toEqual({ ok: true, value: { id: 'f1', path: folder, collapsed: false } })
    expect(addFolder.output.safeParse(result).success).toBe(true)
    expect(store.listByProfile('p1')).toEqual([{ id: 'f1', path: folder, collapsed: false }])
  })

  it('refuses a path that is missing, relative, or a file', async () => {
    const { add, store } = setup()
    const file = join(base, 'file.txt')
    writeFileSync(file, 'x')
    for (const path of [join(base, 'missing'), 'notes', file]) {
      const result = await add({ profileId: 'p1', path })
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid-path' } })
      expect(addFolder.output.safeParse(result).success).toBe(true)
    }
    expect(store.listByProfile('p1')).toEqual([])
  })

  it('refuses an unknown profile', async () => {
    const { add } = setup()
    expect(await add({ profileId: 'missing', path: base })).toMatchObject({ ok: false, error: { code: 'unknown-profile' } })
  })

  it('gives the existing row for a duplicate, also with another case or a trailing separator', async () => {
    const { add, store } = setup()
    const folder = join(base, 'notes')
    mkdirSync(folder)
    const first = await add({ profileId: 'p1', path: folder })
    expect(await add({ profileId: 'p1', path: folder })).toEqual(first)
    expect(await add({ profileId: 'p1', path: `${folder.toUpperCase()}\\` })).toEqual(first)
    expect(store.listByProfile('p1')).toHaveLength(1)
  })
})
