import { isExistingFolder } from '../../../building-blocks/folder'
import { err, ok, type Result } from '../../../building-blocks/result'
import { MESSAGES } from '../profile'
import type { ProfileStore } from '../profile.store'
import type { ChooseDirectoriesError } from './choose-directories.contract'

export interface ChooseDirectoriesInput {
  directories: { profileId: string; workspaceDirectory: string }[]
}

/** Checks each workspace directory first, then saves all directories in one transaction. One bad workspace directory saves none. */
export function chooseDirectoriesHandler(
  store: ProfileStore,
  { directories }: ChooseDirectoriesInput
): Result<Record<string, never>, ChooseDirectoriesError> {
  for (const { profileId, workspaceDirectory } of directories) {
    if (!store.find(profileId)) return err('unknown-profile', MESSAGES.unknownProfile)
    if (!isExistingFolder(workspaceDirectory)) return err('invalid-workspace-directory', MESSAGES.invalidWorkspaceDirectory)
  }
  store.transaction(() => {
    for (const { profileId, workspaceDirectory } of directories) store.setWorkspaceDirectory(profileId, workspaceDirectory)
  })
  return ok({})
}
