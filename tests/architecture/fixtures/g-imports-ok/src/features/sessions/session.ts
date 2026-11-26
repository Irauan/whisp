// Fixture of valid imports in the target layout: the domain file imports building-blocks.
import type { Result } from '../../building-blocks/result'

export interface Session {
  id: string
}

export const open = (id: string): Result<Session> =>
  id ? { ok: true, value: { id } } : { ok: false, error: 'no id' }
