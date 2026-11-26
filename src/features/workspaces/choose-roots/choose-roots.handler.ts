import { isExistingFolder } from '../../../building-blocks/folder'
import { err, ok, type Result } from '../../../building-blocks/result'
import { MESSAGES } from '../workspace'
import type { WorkspaceStore } from '../workspace.store'
import type { ChooseRootsError } from './choose-roots.contract'

export interface ChooseRootsInput {
  roots: { workspaceId: string; root: string }[]
}

/** Checks each root first, then saves all roots in one transaction. One bad root saves none. */
export function chooseRootsHandler(
  store: WorkspaceStore,
  { roots }: ChooseRootsInput
): Result<Record<string, never>, ChooseRootsError> {
  for (const { workspaceId, root } of roots) {
    if (!store.find(workspaceId)) return err('unknown-workspace', MESSAGES.unknownWorkspace)
    if (!isExistingFolder(root)) return err('invalid-root', MESSAGES.invalidRoot)
  }
  store.transaction(() => {
    for (const { workspaceId, root } of roots) store.setRoot(workspaceId, root)
  })
  return ok({})
}
