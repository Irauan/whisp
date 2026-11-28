import { ok, type Result } from '../../../building-blocks/result'
import { type Notice, type ProfileView, viewOf } from '../profile'
import type { ProfileStore } from '../profile.store'

export interface ProfileSnapshot {
  profiles: ProfileView[]
  currentId: string | null
  notices: Notice[]
}

export function listProfilesHandler(store: ProfileStore, notices: readonly Notice[]): Result<ProfileSnapshot, never> {
  return ok({ profiles: store.list().map(viewOf), currentId: store.currentId(), notices: [...notices] })
}
