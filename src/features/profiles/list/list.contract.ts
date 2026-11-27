import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'
import { noticeSchema, profileViewSchema } from '../profile'

/**
 * Loads the snapshot of the profiles: each profile, the current one, and the messages about
 * the start of Aether. The renderer loads a new snapshot after each change.
 */
export const listProfiles = defineContract(
  'profiles.list',
  z.strictObject({}),
  z.strictObject({
    profiles: z.array(profileViewSchema),
    /** Null when no profile exists. */
    currentId: z.string().nullable(),
    notices: z.array(noticeSchema)
  }),
  [],
  {
    valid: [{}],
    invalid: [null, 'not an object', 42, [], { extra: true }]
  }
)
