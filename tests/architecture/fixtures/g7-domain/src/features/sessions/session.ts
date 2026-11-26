// Fixture for G7: a domain file that imports Node.
import { readFileSync } from 'node:fs'

export const load = (path: string): string => readFileSync(path, 'utf8')
