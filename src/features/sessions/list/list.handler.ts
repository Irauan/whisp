import { ok, type Result } from '../../../building-blocks/result'
import type { Session } from '../session'
import type { SessionStore } from '../session.store'

export function listSessionsHandler(store: SessionStore, { workspaceId }: { workspaceId: string }): Result<{ sessions: Session[] }, never> {
  return ok({ sessions: store.listByWorkspace(workspaceId) })
}
