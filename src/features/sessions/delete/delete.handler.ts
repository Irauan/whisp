import { err, ok, type Result } from '../../../building-blocks/result'
import { MESSAGES } from '../session'
import type { SessionStore } from '../session.store'
import type { DeleteSessionError } from './delete.contract'

export function deleteSessionHandler(store: SessionStore, { id }: { id: string }): Result<Record<string, never>, DeleteSessionError> {
  return store.remove(id) ? ok({}) : err('unknown-session', MESSAGES.unknownSession)
}
