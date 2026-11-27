import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'

/**
 * Deletes one session. The window asks the user first. Decision 0005: the old `workspace.json`
 * and `runs/` stay as they are.
 */
export const deleteSession = defineContract(
  'sessions.delete',
  z.strictObject({ id: z.string().min(1) }),
  z.strictObject({}),
  ['unknown-session'],
  {
    valid: [{ id: 's1' }],
    invalid: [null, {}, { id: '' }, { id: 1 }, { id: 's1', extra: true }]
  }
)

export type DeleteSessionError = (typeof deleteSession.errors)[number]
