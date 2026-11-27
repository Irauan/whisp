import type { Mode } from '../../../building-blocks/mode'
import { ok, type Result } from '../../../building-blocks/result'
import { modeForNewSession, type Session } from '../session'
import type { SessionStore } from '../session.store'

export function listSessionsHandler(
  store: SessionStore,
  { profileId }: { profileId: string }
): Result<{ sessions: Session[]; newSessionMode: Mode }, never> {
  const sessions = store.listByProfile(profileId)
  return ok({ sessions, newSessionMode: modeForNewSession(sessions) })
}
