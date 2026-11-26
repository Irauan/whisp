import { ok, type Result } from '../../../building-blocks/result'
import { type Notice, type WorkspaceView, viewOf } from '../workspace'
import type { WorkspaceStore } from '../workspace.store'

export interface WorkspaceSnapshot {
  workspaces: WorkspaceView[]
  currentId: string | null
  notices: Notice[]
}

export function listWorkspacesHandler(store: WorkspaceStore, notices: readonly Notice[]): Result<WorkspaceSnapshot, never> {
  return ok({ workspaces: store.list().map(viewOf), currentId: store.currentId(), notices: [...notices] })
}
