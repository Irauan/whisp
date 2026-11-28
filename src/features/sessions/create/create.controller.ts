import type { Clock } from '../../../building-blocks/clock.port'
import type { Database } from '../../../building-blocks/database'
import type { Ids } from '../../../building-blocks/ids'
import { SessionStore } from '../session.store'
import { createSessionHandler, type CreateSessionInput } from './create.handler'

/** The input is already parsed against the contract. */
export const createSessionController = (database: Database, clock: Clock, ids: Ids) => async (input: CreateSessionInput) =>
  createSessionHandler({ store: new SessionStore(database), clock, ids }, input)
