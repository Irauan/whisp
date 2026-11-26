// Fixture: a store in the main zone, with Node.
import { readFileSync } from 'node:fs'

export const load = (path: string): string => readFileSync(path, 'utf8')
