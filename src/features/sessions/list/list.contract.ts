import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'
import { MODES } from '../../../building-blocks/mode'
import { sessionStatusSchema } from '../entry'
import { sessionSchema } from '../session'

/**
 * One session in the list. It has the saved fields of the session, the unread mark, and the live state
 * that the sidebar shows (story S11): the status, the IDs of the open cards, and the revision of the
 * session events that this state matches. `sessionSchema` stays the saved session, with no live field.
 */
export const sessionItemSchema = sessionSchema.extend({
  unread: z.boolean(),
  status: sessionStatusSchema,
  openCardIds: z.array(z.string()),
  revision: z.number().int().min(0)
})

export type SessionItem = z.output<typeof sessionItemSchema>

/** One folder of the profile, as a group of the sidebar. */
export const folderItemSchema = z.strictObject({
  id: z.string(),
  path: z.string(),
  collapsed: z.boolean()
})

/**
 * Lists the sessions of one profile, oldest first, with the mode that a new session of the
 * profile starts with. The renderer cannot import the domain, so the main process applies the
 * rule of decision 0012 and sends its result. It lists also the folders of the profile, the newest
 * activity first, and the live state of each session.
 */
export const listSessions = defineContract(
  'sessions.list',
  z.strictObject({ profileId: z.string().min(1) }),
  z.strictObject({ sessions: z.array(sessionItemSchema), folders: z.array(folderItemSchema), newSessionMode: z.enum(MODES) }),
  [],
  {
    valid: [{ profileId: 'w1' }],
    invalid: [null, {}, { profileId: '' }, { profileId: 1 }, { profileId: 'w1', extra: true }]
  }
)
