import type { Database } from '../../../building-blocks/database'
import { SessionStore } from '../session.store'
import { openSessionHandler } from './open.handler'

/** The input is already parsed against the contract. */
export const openSessionController = (database: Database) => async (input: { id: string }) =>
  openSessionHandler(new SessionStore(database), input)
