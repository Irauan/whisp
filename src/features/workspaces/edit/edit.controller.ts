import type { Database } from '../../../building-blocks/database'
import { WorkspaceStore } from '../workspace.store'
import { editWorkspaceHandler, type EditWorkspaceInput } from './edit.handler'

/** The input is already parsed against the contract. */
export const editWorkspaceController = (database: Database) => async (input: EditWorkspaceInput) =>
  editWorkspaceHandler(new WorkspaceStore(database), input)
