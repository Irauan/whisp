import type { Database } from '../../../building-blocks/database'
import type { Notice } from '../profile'
import { ProfileStore } from '../profile.store'
import { listProfilesHandler } from './list.handler'

/** The input is already parsed against the contract. `notices` lists the messages of the start. */
export const listProfilesController = (database: Database, notices: () => readonly Notice[]) => async () =>
  listProfilesHandler(new ProfileStore(database), notices())
