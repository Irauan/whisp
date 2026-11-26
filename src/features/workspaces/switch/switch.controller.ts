import type { Database } from '../../../building-blocks/database'
import { WorkspaceStore } from '../workspace.store'
import { switchWorkspaceHandler } from './switch.handler'

/** The input is already parsed against the contract. */
export const switchWorkspaceController = (database: Database) => async (input: { id: string }) =>
  switchWorkspaceHandler(new WorkspaceStore(database), input)
