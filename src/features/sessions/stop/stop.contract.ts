import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'

/**
 * Stops the turn of a session. It works in the states Starting, Working and Waiting for
 * permission. Stop in the state Idle changes nothing. The turn then ends with the notice "Stopped.".
 */
export const stopSession = defineContract(
  'sessions.stop',
  z.strictObject({ id: z.string().min(1) }),
  z.strictObject({}),
  ['unknown-session'],
  {
    valid: [{ id: 's1' }],
    invalid: [null, {}, { id: '' }, { id: 1 }, { id: 's1', extra: true }]
  }
)

export type StopSessionError = (typeof stopSession.errors)[number]
