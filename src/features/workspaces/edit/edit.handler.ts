import { isAbsolutePath, isExistingFolder } from '../../../building-blocks/folder'
import { err, ok, type Result } from '../../../building-blocks/result'
import { MESSAGES, type GithubAccount } from '../workspace'
import type { WorkspaceStore } from '../workspace.store'
import type { EditWorkspaceError } from './edit.contract'

export interface EditWorkspaceInput {
  id: string
  name: string
  root: string
  github: GithubAccount | null
  claudeFolder: string | null
  claudeProfile: string | null
}

export function editWorkspaceHandler(
  store: WorkspaceStore,
  { id, ...settings }: EditWorkspaceInput
): Result<Record<string, never>, EditWorkspaceError> {
  const current = store.find(id)
  if (!current) return err('unknown-workspace', MESSAGES.unknownWorkspace)
  // A root that the user did not change stays, also when its folder is gone: the user can still edit the name.
  if (settings.root !== current.root && !isExistingFolder(settings.root)) {
    return err('invalid-root', MESSAGES.invalidRoot)
  }
  if (settings.claudeFolder !== null && !isAbsolutePath(settings.claudeFolder)) {
    return err('invalid-claude-folder', MESSAGES.invalidClaudeFolder)
  }
  store.update({ ...current, ...settings })
  return ok({})
}
