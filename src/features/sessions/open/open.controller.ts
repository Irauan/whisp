import type { Database } from '../../../building-blocks/database'
import { SessionStore } from '../session.store'
import type { Transcript } from '../transcript.store'
import { openSessionHandler } from './open.handler'

/** The input is already parsed against the contract. */
export const openSessionController = (database: Database, transcript: Transcript) => async (input: { id: string }) =>
  openSessionHandler({ store: new SessionStore(database), transcript }, input)
