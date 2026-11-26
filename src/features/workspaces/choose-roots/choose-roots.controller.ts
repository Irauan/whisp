import type { Database } from '../../../building-blocks/database'
import { WorkspaceStore } from '../workspace.store'
import { chooseRootsHandler, type ChooseRootsInput } from './choose-roots.handler'

/** The input is already parsed against the contract. */
export const chooseRootsController = (database: Database) => async (input: ChooseRootsInput) =>
  chooseRootsHandler(new WorkspaceStore(database), input)
