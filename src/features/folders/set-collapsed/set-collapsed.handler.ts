import { err, ok, type Result } from '../../../building-blocks/result'
import { MESSAGES } from '../folder'
import type { FolderStore } from '../folders.store'
import type { SetFolderCollapsedError } from './set-collapsed.contract'

export function setFolderCollapsedHandler(
  store: FolderStore,
  { folderId, collapsed }: { folderId: string; collapsed: boolean }
): Result<Record<string, never>, SetFolderCollapsedError> {
  return store.setCollapsed(folderId, collapsed) ? ok({}) : err('unknown-folder', MESSAGES.unknownFolder)
}
