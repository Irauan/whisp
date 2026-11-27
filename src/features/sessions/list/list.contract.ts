import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'
import { MODES } from '../../../building-blocks/mode'
import { sessionSchema } from '../session'

/**
 * Lists the sessions of one profile, oldest first, with the mode that a new session of the
 * profile starts with. The renderer cannot import the domain, so the main process applies the
 * rule of decision 0012 and sends its result.
 */
export const listSessions = defineContract(
  'sessions.list',
  z.strictObject({ profileId: z.string().min(1) }),
  z.strictObject({ sessions: z.array(sessionSchema), newSessionMode: z.enum(MODES) }),
  [],
  {
    valid: [{ profileId: 'w1' }],
    invalid: [null, {}, { profileId: '' }, { profileId: 1 }, { profileId: 'w1', extra: true }]
  }
)
