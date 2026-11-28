import { err, ok, type Result } from '../../../building-blocks/result'
import { MESSAGES } from '../folder'
import type { FolderStore } from '../folders.store'
import type { RemoveFolderError } from './remove.contract'

export function removeFolderHandler(store: FolderStore, { folderId }: { folderId: string }): Result<Record<string, never>, RemoveFolderError> {
  // One transaction: a session cannot join the folder between the count and the delete.
  return store.transaction(() => {
    if (!store.find(folderId)) return err('unknown-folder', MESSAGES.unknownFolder)
    if (store.sessionCount(folderId) > 0) return err('folder-has-sessions', MESSAGES.hasSessions)
    store.remove(folderId)
    return ok({})
  })
}
