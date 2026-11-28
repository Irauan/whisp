import type { Clock } from '../../../building-blocks/clock.port'
import { isExistingFolder, isSameFolder } from '../../../building-blocks/folder'
import type { Ids } from '../../../building-blocks/ids'
import { err, ok, type Result } from '../../../building-blocks/result'
import { MESSAGES, type Folder } from '../folder'
import type { FolderStore } from '../folders.store'
import type { AddFolderError } from './add.contract'

export interface AddFolderDeps {
  store: FolderStore
  clock: Clock
  ids: Ids
}

export function addFolderHandler({ store, clock, ids }: AddFolderDeps, input: { profileId: string; path: string }): Result<Folder, AddFolderError> {
  if (!store.profileExists(input.profileId)) return err('unknown-profile', MESSAGES.unknownProfile)
  if (!isExistingFolder(input.path)) return err('invalid-path', MESSAGES.invalidPath)
  // One transaction: the check for a duplicate and the insert see the same rows.
  return store.transaction(() => {
    const existing = store.listByProfile(input.profileId).find((folder) => isSameFolder(folder.path, input.path))
    if (existing) return ok(existing)
    const id = ids.next()
    store.insert({ id, profileId: input.profileId, path: input.path, createdAt: clock.now().toISOString() })
    return ok({ id, path: input.path, collapsed: false })
  })
}
