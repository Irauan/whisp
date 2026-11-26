import type { Clock } from '../../../building-blocks/clock.port'
import type { Database } from '../../../building-blocks/database'
import type { Ids } from '../../../building-blocks/ids'
import { WorkspaceStore } from '../workspace.store'
import { addWorkspaceHandler, type AddWorkspaceInput } from './add.handler'

/** The input is already parsed against the contract. */
export const addWorkspaceController = (database: Database, clock: Clock, ids: Ids) => async (input: AddWorkspaceInput) =>
  addWorkspaceHandler({ store: new WorkspaceStore(database), clock, ids }, input)
