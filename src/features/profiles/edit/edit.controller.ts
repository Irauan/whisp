import type { Clock } from '../../../building-blocks/clock.port'
import type { Database } from '../../../building-blocks/database'
import type { Ids } from '../../../building-blocks/ids'
import { ProfileStore } from '../profile.store'
import { editProfileHandler, type EditProfileInput } from './edit.handler'

/** The input is already parsed against the contract. */
export const editProfileController = (database: Database, clock: Clock, ids: Ids) => async (input: EditProfileInput) =>
  editProfileHandler(new ProfileStore(database), input, clock, ids)
