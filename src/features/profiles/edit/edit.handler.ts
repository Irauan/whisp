import type { Clock } from '../../../building-blocks/clock.port'
import { isAbsolutePath, isExistingFolder } from '../../../building-blocks/folder'
import type { Ids } from '../../../building-blocks/ids'
import { err, ok, type Result } from '../../../building-blocks/result'
import { MESSAGES, type GithubAccount } from '../profile'
import type { ProfileStore } from '../profile.store'
import type { EditProfileError } from './edit.contract'

export interface EditProfileInput {
  id: string
  name: string
  workspaceDirectory: string
  github: GithubAccount | null
  claudeFolder: string | null
}

export function editProfileHandler(
  store: ProfileStore,
  { id, ...settings }: EditProfileInput,
  clock: Clock,
  ids: Ids
): Result<Record<string, never>, EditProfileError> {
  const current = store.find(id)
  if (!current) return err('unknown-profile', MESSAGES.unknownProfile)
  // A workspace directory that the user did not change stays, also when its folder is gone: the user can still edit the name.
  if (settings.workspaceDirectory !== current.workspaceDirectory && !isExistingFolder(settings.workspaceDirectory)) {
    return err('invalid-workspace-directory', MESSAGES.invalidWorkspaceDirectory)
  }
  if (settings.claudeFolder !== null && !isAbsolutePath(settings.claudeFolder)) {
    return err('invalid-claude-folder', MESSAGES.invalidClaudeFolder)
  }
  store.transaction(() => {
    store.update({ ...current, ...settings })
    store.saveClaude(id, { configFolder: settings.claudeFolder }, ids, clock.now().toISOString())
  })
  return ok({})
}
