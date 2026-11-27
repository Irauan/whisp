import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'
import { sessionSchema } from '../session'

/** Lists the sessions of one profile, oldest first. In this version they are the drafts of the import. */
export const listSessions = defineContract(
  'sessions.list',
  z.strictObject({ profileId: z.string().min(1) }),
  z.strictObject({ sessions: z.array(sessionSchema) }),
  [],
  {
    valid: [{ profileId: 'w1' }],
    invalid: [null, {}, { profileId: '' }, { profileId: 1 }, { profileId: 'w1', extra: true }]
  }
)
