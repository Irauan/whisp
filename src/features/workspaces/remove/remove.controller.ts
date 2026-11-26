import type { Database } from '../../../building-blocks/database'
import { WorkspaceStore } from '../workspace.store'
import { removeWorkspaceHandler } from './remove.handler'

/** The input is already parsed against the contract. */
export const removeWorkspaceController = (database: Database) => async (input: { id: string }) =>
  removeWorkspaceHandler(new WorkspaceStore(database), input)
