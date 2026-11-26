import { err, ok, type Result } from '../../../building-blocks/result'
import { MESSAGES } from '../workspace'
import type { WorkspaceStore } from '../workspace.store'
import type { SwitchWorkspaceError } from './switch.contract'

export function switchWorkspaceHandler(
  store: WorkspaceStore,
  { id }: { id: string }
): Result<Record<string, never>, SwitchWorkspaceError> {
  if (!store.find(id)) return err('unknown-workspace', MESSAGES.unknownWorkspace)
  store.setCurrent(id)
  return ok({})
}
