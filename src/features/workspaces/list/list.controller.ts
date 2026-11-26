import type { Database } from '../../../building-blocks/database'
import type { Notice } from '../workspace'
import { WorkspaceStore } from '../workspace.store'
import { listWorkspacesHandler } from './list.handler'

/** The input is already parsed against the contract. `notices` lists the messages of the start. */
export const listWorkspacesController = (database: Database, notices: () => readonly Notice[]) => async () =>
  listWorkspacesHandler(new WorkspaceStore(database), notices())
