import { err, ok, type Result } from '../../../building-blocks/result'
import { MESSAGES } from '../profile'
import type { ProfileStore } from '../profile.store'
import type { SwitchProfileError } from './switch.contract'

export function switchProfileHandler(
  store: ProfileStore,
  { id }: { id: string }
): Result<Record<string, never>, SwitchProfileError> {
  if (!store.find(id)) return err('unknown-profile', MESSAGES.unknownProfile)
  store.setCurrent(id)
  return ok({})
}
