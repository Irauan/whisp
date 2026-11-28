import type { Viewing } from '../viewing.store'
import { setViewingHandler } from './set-viewing.handler'

/** The input is already parsed against the contract. */
export const setViewingController = (viewing: Viewing) => async (input: { sessionId: string | null }) => setViewingHandler(viewing, input)
