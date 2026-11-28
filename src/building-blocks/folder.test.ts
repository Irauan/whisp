import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from './database'
import { absoluteIn, folderRowPath, isExistingFolder, isInsideFolder, isSameFolder } from './folder'
import { MIGRATIONS } from './migrations'

describe('isSameFolder', () => {
  it('is true for the same folder with another case, slash or trailing separator', () => {
    expect(isSameFolder('C:\\Work\\Repo-A', 'c:/work/repo-a/')).toBe(true)
    expect(isSameFolder('C:\\work\\repo-a', 'C:\\work\\repo-a')).toBe(true)
  })

  it('is false for another folder, a parent and a child', () => {
    expect(isSameFolder('C:\\work\\repo-a', 'C:\\work\\repo-b')).toBe(false)
    expect(isSameFolder('C:\\work\\repo-a', 'C:\\work')).toBe(false)
    expect(isSameFolder('C:\\work\\repo-a', 'C:\\work\\repo-a\\src')).toBe(false)
  })
})

describe('isInsideFolder', () => {
  it('is true for the folder itself and for a path under it', () => {
    expect(isInsideFolder('C:\\work\\repo-a', 'C:\\work\\repo-a')).toBe(true)
    expect(isInsideFolder('C:\\work\\repo-a', 'C:\\work\\repo-a\\src\\deep')).toBe(true)
    expect(isInsideFolder('C:\\work\\repo-a\\', 'C:\\work\\repo-a\\src')).toBe(true)
    expect(isInsideFolder('C:\\work\\repo-a', 'C:\\work\\repo-a\\..hidden')).toBe(true)
  })

  it('is false for a sibling, a parent, a folder with the same start and another drive', () => {
    expect(isInsideFolder('C:\\work\\repo-a', 'C:\\work\\repo-b')).toBe(false)
    expect(isInsideFolder('C:\\work\\repo-a', 'C:\\work')).toBe(false)
    expect(isInsideFolder('C:\\work\\repo-a', 'C:\\work\\repo-a2')).toBe(false)
    expect(isInsideFolder('C:\\work\\repo-a', 'D:\\work\\repo-a')).toBe(false)
  })

  it('compares without case and with either slash, as Windows does', () => {
    expect(isInsideFolder('C:\\Work\\Repo-A', 'c:/work/repo-a/SRC')).toBe(true)
  })

  it('does not take a path with dots as inside', () => {
    expect(isInsideFolder('C:\\work\\repo-a', 'C:\\work\\repo-a\\..\\repo-b')).toBe(false)
  })
})

describe('absoluteIn', () => {
  it('keeps an absolute path and resolves a relative path against the base', () => {
    expect(absoluteIn('C:\\work\\repo-a', 'D:\\notes\\x.txt')).toBe('D:\\notes\\x.txt')
    expect(absoluteIn('C:\\work\\repo-a', 'src/main.ts')).toBe('C:\\work\\repo-a\\src\\main.ts')
  })
})

describe('isExistingFolder', () => {
  let folder: string
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'aether-folder-'))
  })
  afterEach(() => rm(folder, { recursive: true, force: true }))

  it('is true for a folder only', async () => {
    const file = join(folder, 'a.txt')
    await writeFile(file, 'x')
    expect(isExistingFolder(folder)).toBe(true)
    expect(isExistingFolder(file)).toBe(false)
    expect(isExistingFolder(join(folder, 'missing'))).toBe(false)
  })
})

describe('folderRowPath', () => {
  function setup() {
    const opened = openDatabase(':memory:', MIGRATIONS)
    if (!opened.ok) throw new Error(opened.error.message)
    const { database } = opened.value
    database.prepare("INSERT INTO profiles (id, name, created_at) VALUES ('p1', 'One', '2026-01-01')").run()
    database.prepare("INSERT INTO profiles (id, name, created_at) VALUES ('p2', 'Two', '2026-01-01')").run()
    database.prepare("INSERT INTO folders (id, profile_id, path, created_at) VALUES ('f1', 'p1', ?, '2026-01-01')").run('C:\\Work\\Repo')
    return database
  }

  it('gives the path of the row of the same folder, for the same profile only', () => {
    const database = setup()
    expect(folderRowPath(database, 'p1', 'C:\\Work\\Repo')).toBe('C:\\Work\\Repo')
    expect(folderRowPath(database, 'p1', 'C:\\Work\\Other')).toBe('C:\\Work\\Other')
    expect(folderRowPath(database, 'p2', 'c:\\work\\repo')).toBe('c:\\work\\repo')
  })

  // The comparison follows the platform: on Windows it ignores the case, the kind of slash and a trailing separator.
  it.runIf(process.platform === 'win32')('gives the row path for another case, slash or trailing separator', () => {
    const database = setup()
    expect(folderRowPath(database, 'p1', 'c:\\work\\repo')).toBe('C:\\Work\\Repo')
    expect(folderRowPath(database, 'p1', 'C:/Work/Repo/')).toBe('C:\\Work\\Repo')
  })
})
