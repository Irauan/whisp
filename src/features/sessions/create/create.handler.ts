import type { Clock } from '../../../building-blocks/clock.port'
import { isExistingFolder } from '../../../building-blocks/folder'
import type { Ids } from '../../../building-blocks/ids'
import type { Mode } from '../../../building-blocks/mode'
import { err, ok, type Result } from '../../../building-blocks/result'
import { MESSAGES, PROVIDER_KIND, titleOf, type Attachment } from '../session'
import type { SessionStore } from '../session.store'
import type { CreateSessionError } from './create.contract'

export interface CreateSessionInput {
  profileId: string
  prompt: string
  mode: Mode
  model: string
  sourcePath: string
  attachments: Attachment[]
}

export interface CreateSessionDeps {
  store: SessionStore
  clock: Clock
  ids: Ids
}

export function createSessionHandler(
  { store, clock, ids }: CreateSessionDeps,
  input: CreateSessionInput
): Result<{ id: string }, CreateSessionError> {
  if (!store.profileExists(input.profileId)) return err('unknown-profile', MESSAGES.unknownProfile)
  if (!isExistingFolder(input.sourcePath)) return err('invalid-source-path', MESSAGES.invalidSourcePath)
  const id = ids.next()
  store.insert({
    id,
    profileId: input.profileId,
    title: titleOf(input.prompt),
    prompt: input.prompt,
    // The mode is saved as the user chose it. Only a new session never copies Approve all.
    mode: input.mode,
    // The account that the next agent of this session uses: the current account of the profile (decision 0014).
    providerId: store.currentProvider(input.profileId, PROVIDER_KIND)?.id ?? null,
    sourcePath: input.sourcePath,
    model: input.model,
    attachments: input.attachments,
    createdAt: clock.now().toISOString()
  })
  return ok({ id })
}
