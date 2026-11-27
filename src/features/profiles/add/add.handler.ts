import type { Clock } from '../../../building-blocks/clock.port'
import { isAbsolutePath, isExistingFolder } from '../../../building-blocks/folder'
import type { Ids } from '../../../building-blocks/ids'
import { err, ok, type Result } from '../../../building-blocks/result'
import { MESSAGES, type GithubAccount } from '../profile'
import type { ProfileStore } from '../profile.store'
import type { AddProfileError } from './add.contract'

export interface AddProfileInput {
  name: string
  workspaceDirectory: string
  github: GithubAccount | null
  claudeFolder: string | null
}

export interface AddProfileDeps {
  store: ProfileStore
  clock: Clock
  ids: Ids
}

export function addProfileHandler(
  { store, clock, ids }: AddProfileDeps,
  input: AddProfileInput
): Result<{ id: string }, AddProfileError> {
  if (!isExistingFolder(input.workspaceDirectory)) return err('invalid-workspace-directory', MESSAGES.invalidWorkspaceDirectory)
  if (input.claudeFolder !== null && !isAbsolutePath(input.claudeFolder)) {
    return err('invalid-claude-folder', MESSAGES.invalidClaudeFolder)
  }
  const id = ids.next()
  const createdAt = clock.now().toISOString()
  store.transaction(() => {
    store.insert({ id, ...input, createdAt })
    store.saveClaude(id, { configFolder: input.claudeFolder }, ids, createdAt)
    store.setCurrent(id)
  })
  return ok({ id })
}
