import type { Database } from '../../../building-blocks/database'
import { SessionStore } from '../session.store'
import type { Transcript } from '../transcript.store'
import { listSessionsHandler } from './list.handler'

/** The input is already parsed against the contract. */
export const listSessionsController = (database: Database, transcript: Transcript) => async (input: { profileId: string }) =>
  listSessionsHandler({ store: new SessionStore(database), transcript }, input)
