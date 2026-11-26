import type { Database } from '../../../building-blocks/database'
import { SessionStore } from '../session.store'
import { listSessionsHandler } from './list.handler'

/** The input is already parsed against the contract. */
export const listSessionsController = (database: Database) => async (input: { workspaceId: string }) =>
  listSessionsHandler(new SessionStore(database), input)
