import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'
import { sessionSchema } from '../session'

/**
 * Opens one session: it returns the saved session, with its prompt and its mode. The window of a
 * draft shows the prompt in the composer. A later story adds the entries of the conversation.
 */
export const openSession = defineContract(
  'sessions.open',
  z.strictObject({ id: z.string().min(1) }),
  z.strictObject({ session: sessionSchema }),
  ['unknown-session'],
  {
    valid: [{ id: 's1' }],
    invalid: [null, {}, { id: '' }, { id: 1 }, { id: 's1', extra: true }]
  }
)

export type OpenSessionError = (typeof openSession.errors)[number]
