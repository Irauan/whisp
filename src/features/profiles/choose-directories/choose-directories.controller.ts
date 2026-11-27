import type { Database } from '../../../building-blocks/database'
import { ProfileStore } from '../profile.store'
import { chooseDirectoriesHandler, type ChooseDirectoriesInput } from './choose-directories.handler'

/** The input is already parsed against the contract. */
export const chooseDirectoriesController = (database: Database) => async (input: ChooseDirectoriesInput) =>
  chooseDirectoriesHandler(new ProfileStore(database), input)
