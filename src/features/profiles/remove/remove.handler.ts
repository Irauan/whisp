import { err, ok, type Result } from '../../../building-blocks/result'
import { MESSAGES } from '../profile'
import type { ProfileStore } from '../profile.store'
import type { RemoveProfileError } from './remove.contract'

export function removeProfileHandler(
  store: ProfileStore,
  { id }: { id: string }
): Result<Record<string, never>, RemoveProfileError> {
  return store.remove(id) ? ok({}) : err('unknown-profile', MESSAGES.unknownProfile)
}
