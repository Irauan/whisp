import type { Clock } from '../../../building-blocks/clock.port'
import type { Database } from '../../../building-blocks/database'
import type { Ids } from '../../../building-blocks/ids'
import { FolderStore } from '../folders.store'
import { addFolderHandler } from './add.handler'

/** The input is already parsed against the contract. */
export const addFolderController = (database: Database, clock: Clock, ids: Ids) => async (input: { profileId: string; path: string }) =>
  addFolderHandler({ store: new FolderStore(database), clock, ids }, input)
