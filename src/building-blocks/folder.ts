import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'

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
