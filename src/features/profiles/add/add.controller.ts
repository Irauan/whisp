import type { Clock } from '../../../building-blocks/clock.port'
import type { Database } from '../../../building-blocks/database'
import type { Ids } from '../../../building-blocks/ids'
import { ProfileStore } from '../profile.store'
import { addProfileHandler, type AddProfileInput } from './add.handler'

/** The input is already parsed against the contract. */
export const addProfileController = (database: Database, clock: Clock, ids: Ids) => async (input: AddProfileInput) =>
  addProfileHandler({ store: new ProfileStore(database), clock, ids }, input)
