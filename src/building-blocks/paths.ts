import { existsSync, realpathSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

/**
 * Path comparison for the trust and directory questions (S3 review notes for S6). A path is
 * resolved before it is compared: `..`, junctions and symbolic links go away, and on Windows the
 * letter case does not count. A UNC path is never inside a directory, because Aether does not
 * trust a network share to be the folder that its name says.
 */

const WINDOWS = process.platform === 'win32'

/** True for a UNC path, `\\server\share`, and for the device forms `\\?\UNC\...` and `\\.\...`. */
export function isUnc(path: string): boolean {
  return /^[\\/]{2}/.test(path)
}

/** Removes the long-path prefix `\\?\` from a drive path. `\\?\UNC\server\share` becomes `\\server\share`. */
function withoutLongPrefix(path: string): string {
  if (/^\\\\\?\\UNC\\/i.test(path)) return `\\\\${path.slice(8)}`
  if (/^\\\\\?\\[a-z]:/i.test(path)) return path.slice(4)
  return path
}

/** Windows ignores dots and spaces at the end of a name: `repo.` is `repo`. Remove them, so that both spellings give one key. */
function withoutTrailingDots(path: string): string {
  return WINDOWS ? path.replace(/[. ]+(?=\\|$)/g, '') : path
}

/**
 * The real path of a folder: absolute, with links resolved and the letter case of the disk. A UNC
 * path is returned as it is, without a call to the network. A path that does not exist resolves
 * through its nearest folder that exists. A failure returns the absolute path.
 */
export function resolveReal(path: string): string {
  const absolute = withoutTrailingDots(withoutLongPrefix(resolve(path)))
  if (isUnc(absolute)) return absolute
  const rest: string[] = []
  let probe = absolute
  for (;;) {
    try {
      return withoutLongPrefix(join(realpathSync.native(probe), ...rest.toReversed()))
    } catch {
      const parent = dirname(probe)
      if (parent === probe) return absolute
      rest.push(probe.slice(parent.length).replace(/^[\\/]+/, ''))
      probe = parent
    }
  }
}

/** The key of a folder in the saved answers and in the comparison: its real path, without case on Windows, without a closing separator. */
export function pathKey(path: string): string {
  const real = resolveReal(path)
  const folded = WINDOWS ? real.toLowerCase() : real
  return folded.length > 3 && folded.endsWith(sep) ? folded.slice(0, -1) : folded
}

/** True when the key `candidate` is the key `directory` or lies below it. A sibling whose name starts with the same text is outside. */
export function isInside(candidate: string, directory: string): boolean {
  if (isUnc(candidate) || isUnc(directory)) return false
  const base = directory.endsWith(sep) ? directory : `${directory}${sep}`
  return candidate === directory || candidate.startsWith(base)
}

/**
 * The root of the Git repository that holds the folder: the nearest folder, going up, that has an
 * entry `.git` (a folder, or a file in a worktree or a submodule). The walk stops after the key
 * `stopAt`, when it is given: a repository above the workspace directory is not the repository of a
 * folder in it. It runs no `git` process, so a repository cannot run a program here. Null when there is none.
 */
export function repositoryRootOf(folder: string, stopAt: string | null = null): string | null {
  let current = resolveReal(folder)
  for (;;) {
    if (existsSync(join(current, '.git'))) return current
    if (stopAt !== null && pathKey(current) === stopAt) return null
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}
