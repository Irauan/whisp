// Fixture of valid imports in the target layout: a root file of the feature, in the main zone.
import { readFileSync } from 'node:fs'
import { open, type Session } from './session'

export const load = (path: string): Session | undefined => {
  const result = open(readFileSync(path, 'utf8'))
  return result.ok ? result.value : undefined
}
