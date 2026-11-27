import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { absoluteIn, isExistingFolder, isInsideFolder } from './folder'

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
