import type { Database } from '../../../building-blocks/database'
import { ProfileStore } from '../profile.store'
import { removeProfileHandler } from './remove.handler'

/** The input is already parsed against the contract. */
export const removeProfileController = (database: Database) => async (input: { id: string }) =>
  removeProfileHandler(new ProfileStore(database), input)
