import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'

/**
 * The window tells the main process which session it shows, or null when it shows no session. The
 * main process uses it for the unread mark (story S11): the session that the user looks at gets no mark.
 */
export const setViewing = defineContract(
  'sessions.set-viewing',
  z.strictObject({ sessionId: z.string().min(1).nullable() }),
  z.strictObject({}),
  [],
  {
    valid: [{ sessionId: 's1' }, { sessionId: null }],
    invalid: [null, {}, { sessionId: '' }, { sessionId: 1 }, { sessionId: 's1', extra: true }]
  }
)
