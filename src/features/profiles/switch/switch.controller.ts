import type { Database } from '../../../building-blocks/database'
import { ProfileStore } from '../profile.store'
import { switchProfileHandler } from './switch.handler'

/** The input is already parsed against the contract. */
export const switchProfileController = (database: Database) => async (input: { id: string }) =>
  switchProfileHandler(new ProfileStore(database), input)
