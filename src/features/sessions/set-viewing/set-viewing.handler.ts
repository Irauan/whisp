import { ok, type Result } from '../../../building-blocks/result'
import type { Viewing } from '../viewing.store'

/**
 * Sets the viewed session. The store clears the unread mark of a session that becomes seen. An ID that
 * names no session is harmless: it is never seen, and no mark belongs to it.
 */
export function setViewingHandler(viewing: Viewing, { sessionId }: { sessionId: string | null }): Result<Record<string, never>, never> {
  viewing.setViewed(sessionId)
  return ok({})
}
