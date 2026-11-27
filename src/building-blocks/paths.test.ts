import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isInside, isUnc, pathKey, repositoryRootOf, resolveReal } from './paths'

const WINDOWS = process.platform === 'win32'

let base: string

beforeEach(() => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), 'aether-paths-')))
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
})

const folder = (...parts: string[]) => {
  const path = join(base, ...parts)
  mkdirSync(path, { recursive: true })
  return path
}

describe('isUnc', () => {
  it('is true for UNC and device paths, and false for drive paths', () => {
    expect(isUnc('\\\\server\\share\\folder')).toBe(true)
    expect(isUnc('//server/share/folder')).toBe(true)
    expect(isUnc('\\\\?\\UNC\\server\\share')).toBe(true)
    expect(isUnc('\\\\.\\pipe\\name')).toBe(true)
    expect(isUnc('C:\\folder')).toBe(false)
    expect(isUnc('relative\\folder')).toBe(false)
  })
})

describe('resolveReal and pathKey', () => {
  it('resolves ".." parts', () => {
    const notes = folder('outside', 'notes')
    expect(resolveReal(join(base, 'workspace', '..', 'outside', 'notes'))).toBe(notes)
  })

  it('resolves a junction to its target', () => {
    const target = folder('outside', 'notes')
    const link = join(folder('workspace'), 'linked')
    symlinkSync(target, link, 'junction')
    expect(resolveReal(link)).toBe(target)
    expect(pathKey(link)).toBe(pathKey(target))
  })

  it('resolves the part that exists, for a path that does not', () => {
    const real = folder('workspace')
    expect(resolveReal(join(real, 'missing', 'deeper'))).toBe(join(real, 'missing', 'deeper'))
  })

  it.runIf(WINDOWS)('gives one key for two spellings of the letter case', () => {
    const real = folder('Workspace', 'Repo-B')
    expect(pathKey(real.toUpperCase())).toBe(pathKey(real.toLowerCase()))
    expect(pathKey(real)).toBe(real.toLowerCase())
  })

  it('does not call the network for a UNC path', () => {
    expect(resolveReal('\\\\aether-no-such-server\\share\\folder')).toBe('\\\\aether-no-such-server\\share\\folder')
  })

  it.runIf(WINDOWS)('removes the long-path prefix of a drive path', () => {
    const real = folder('workspace')
    expect(resolveReal(`\\\\?\\${real}`)).toBe(real)
  })
})

describe('isInside', () => {
  it('holds for the directory itself and for a folder below it', () => {
    const root = pathKey(folder('workspace'))
    expect(isInside(root, root)).toBe(true)
    expect(isInside(pathKey(folder('workspace', 'repo-a', 'src')), root)).toBe(true)
  })

  it('does not hold for a sibling whose name starts with the name of the directory', () => {
    const root = pathKey(folder('workspace'))
    expect(isInside(pathKey(folder('workspace-backup', 'notes')), root)).toBe(false)
  })

  it('does not hold for a folder that ".." leaves', () => {
    const root = pathKey(folder('workspace'))
    folder('outside', 'notes')
    expect(isInside(pathKey(join(base, 'workspace', '..', 'outside', 'notes')), root)).toBe(false)
  })

  it('does not hold when a UNC path is on either side', () => {
    expect(isInside('\\\\server\\share\\repo', '\\\\server\\share')).toBe(false)
    expect(isInside('c:\\workspace\\repo', '\\\\server\\share')).toBe(false)
    expect(isInside('\\\\server\\share\\repo', 'c:\\workspace')).toBe(false)
  })

  it('holds below the root of a drive', () => {
    if (!WINDOWS) return
    expect(isInside('c:\\workspace', 'c:\\')).toBe(true)
  })
})

describe('repositoryRootOf', () => {
  it('finds the folder with a .git folder, going up from a folder inside', () => {
    const repository = folder('workspace', 'repo-b')
    mkdirSync(join(repository, '.git'))
    const inside = folder('workspace', 'repo-b', 'packages', 'app')
    expect(repositoryRootOf(inside)).toBe(repository)
    expect(repositoryRootOf(repository)).toBe(repository)
  })

  it('accepts a .git file, as a worktree and a submodule have', () => {
    const repository = folder('workspace', 'repo-w')
    writeFileSync(join(repository, '.git'), 'gitdir: elsewhere')
    expect(repositoryRootOf(repository)).toBe(repository)
  })

  it('returns null for a plain folder', () => {
    expect(repositoryRootOf(folder('workspace', 'notes'))).toBeNull()
  })

  it('goes up past any folder, so a repository above the workspace directory is found', () => {
    mkdirSync(join(folder('home'), '.git'))
    folder('home', 'workspace')
    expect(repositoryRootOf(folder('home', 'workspace', 'notes'))).toBe(join(base, 'home'))
  })

  it('finds the repository behind a junction by the real path', () => {
    const repository = folder('outside', 'repo-j')
    mkdirSync(join(repository, '.git'))
    const link = join(folder('workspace'), 'linked-repo')
    symlinkSync(repository, link, 'junction')
    expect(repositoryRootOf(link)).toBe(repository)
  })
})
