import type { Database } from '../../../building-blocks/database'
import { SessionStore } from '../session.store'
import { deleteSessionHandler } from './delete.handler'

/** The input is already parsed against the contract. */
export const deleteSessionController = (database: Database) => async (input: { id: string }) =>
  deleteSessionHandler(new SessionStore(database), input)
