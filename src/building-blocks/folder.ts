import { statSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import type { Database } from './database'

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

/**
 * True when both paths name the same folder. The comparison follows the platform: on Windows it ignores
 * case, takes both slashes, and ignores a trailing separator.
 */
export function isSameFolder(a: string, b: string): boolean {
  return relative(resolve(a), resolve(b)) === ''
}

/** The absolute path of a reference: an absolute path stays, and a relative path is taken from the base folder. */
export function absoluteIn(base: string, reference: string): string {
  return resolve(base, reference)
}

/**
 * The path of the folder row of the profile that names the same folder as `path`, or `path` when the profile
 * has none (story S11). On Windows the case and the kind of slash do not count. A session saves this path,
 * so the sidebar, which compares the text, puts the session in its folder, and no second row appears.
 */
export function folderRowPath(database: Database, profileId: string, path: string): string {
  const rows = database.prepare('SELECT path FROM folders WHERE profile_id = ?').all(profileId)
  return rows.map((row) => String(row.path)).find((known) => isSameFolder(known, path)) ?? path
}
