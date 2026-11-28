import type { Mode } from '../../../building-blocks/mode'
import { ok, type Result } from '../../../building-blocks/result'
import { modeForNewSession } from '../session'
import type { SessionStore } from '../session.store'
import type { Transcript } from '../transcript.store'
import type { SessionItem } from './list.contract'

export interface ListSessionsDeps {
  store: SessionStore
  /** The live state of the sessions: the status, the open cards and the revision. */
  transcript: Transcript
}

export function listSessionsHandler(
  { store, transcript }: ListSessionsDeps,
  { profileId }: { profileId: string }
): Result<{ sessions: SessionItem[]; folders: { id: string; path: string; collapsed: boolean }[]; newSessionMode: Mode }, never> {
  const saved = store.listByProfile(profileId)
  const unread = store.unreadIdsOf(profileId)
  const sessions = saved.map((session) => ({
    ...session,
    unread: unread.has(session.id),
    status: transcript.statusOf(session.id),
    openCardIds: transcript.openCardIds(session.id),
    revision: transcript.revisionOf(session.id)
  }))
  return ok({ sessions, folders: store.foldersOf(profileId), newSessionMode: modeForNewSession(saved) })
}
