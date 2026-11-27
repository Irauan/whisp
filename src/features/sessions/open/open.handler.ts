import { err, ok, type Result } from '../../../building-blocks/result'
import { MESSAGES, type Session } from '../session'
import type { SessionStore } from '../session.store'
import type { OpenSessionError } from './open.contract'

export function openSessionHandler(store: SessionStore, { id }: { id: string }): Result<{ session: Session }, OpenSessionError> {
  const session = store.find(id)
  return session ? ok({ session }) : err('unknown-session', MESSAGES.unknownSession)
}
