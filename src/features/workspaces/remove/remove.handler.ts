import { err, ok, type Result } from '../../../building-blocks/result'
import { MESSAGES } from '../workspace'
import type { WorkspaceStore } from '../workspace.store'
import type { RemoveWorkspaceError } from './remove.contract'

export function removeWorkspaceHandler(
  store: WorkspaceStore,
  { id }: { id: string }
): Result<Record<string, never>, RemoveWorkspaceError> {
  return store.remove(id) ? ok({}) : err('unknown-workspace', MESSAGES.unknownWorkspace)
}
