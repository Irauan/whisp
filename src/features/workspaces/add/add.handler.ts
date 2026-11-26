import type { Clock } from '../../../building-blocks/clock.port'
import { isAbsolutePath, isExistingFolder } from '../../../building-blocks/folder'
import type { Ids } from '../../../building-blocks/ids'
import { err, ok, type Result } from '../../../building-blocks/result'
import { MESSAGES, type GithubAccount } from '../workspace'
import type { WorkspaceStore } from '../workspace.store'
import type { AddWorkspaceError } from './add.contract'

export interface AddWorkspaceInput {
  name: string
  root: string
  github: GithubAccount | null
  claudeFolder: string | null
  claudeProfile: string | null
}

export interface AddWorkspaceDeps {
  store: WorkspaceStore
  clock: Clock
  ids: Ids
}

export function addWorkspaceHandler(
  { store, clock, ids }: AddWorkspaceDeps,
  input: AddWorkspaceInput
): Result<{ id: string }, AddWorkspaceError> {
  if (!isExistingFolder(input.root)) return err('invalid-root', MESSAGES.invalidRoot)
  if (input.claudeFolder !== null && !isAbsolutePath(input.claudeFolder)) {
    return err('invalid-claude-folder', MESSAGES.invalidClaudeFolder)
  }
  const id = ids.next()
  store.transaction(() => {
    store.insert({ id, ...input, createdAt: clock.now().toISOString() })
    store.setCurrent(id)
  })
  return ok({ id })
}
