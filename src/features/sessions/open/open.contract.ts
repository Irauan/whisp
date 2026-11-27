import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'
import { entryViewSchema, SESSIONS_CHANGED, sessionEventSchema, sessionStatusSchema } from '../entry'
import { sessionSchema } from '../session'

/**
 * Opens one session. It returns a snapshot: the saved session, its entries in order, what the
 * session does now, and the revision that the snapshot has reached. The renderer applies the events
 * `sessions.changed` with a higher revision, and loads a new snapshot when it sees a gap (decision
 * 0002). A draft has no entry yet: the window shows its prompt in the composer.
 */
export const openSession = defineContract(
  'sessions.open',
  z.strictObject({ id: z.string().min(1) }),
  z.strictObject({
    session: sessionSchema,
    entries: z.array(entryViewSchema),
    status: sessionStatusSchema,
    revision: z.number().int().min(0),
    /** True while the user can still change the mode: no entry, no agent session and no turn. */
    draft: z.boolean()
  }),
  ['unknown-session'],
  {
    valid: [{ id: 's1' }],
    invalid: [null, {}, { id: '' }, { id: 1 }, { id: 's1', extra: true }]
  }
)

export type OpenSessionError = (typeof openSession.errors)[number]

/** The name and the schema of the event `sessions.changed`. The renderer checks each event against the schema. */
export { SESSIONS_CHANGED, sessionEventSchema }
