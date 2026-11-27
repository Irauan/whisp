import { statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

/** True when the path is absolute. */
export const isAbsolutePath = (path: string): boolean => isAbsolute(path)

/** True when the path is absolute and names an existing folder. */
export function isExistingFolder(path: string): boolean {
  if (!isAbsolute(path)) return false
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/**
 * True when `path` is the folder or lies under it. The comparison follows the platform: on Windows
 * it ignores case and takes both slashes. A path that leaves the folder with `..` is not inside.
 */
export function isInsideFolder(folder: string, path: string): boolean {
  const way = relative(resolve(folder), resolve(path))
  const leaves = way === '..' || way.startsWith('..\\') || way.startsWith('../')
  return !leaves && !isAbsolute(way)
}

/** The absolute path of a reference: an absolute path stays, and a relative path is taken from the base folder. */
export function absoluteIn(base: string, reference: string): string {
  return resolve(base, reference)
}
