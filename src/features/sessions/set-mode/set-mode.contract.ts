import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'
import { MODES } from '../../../building-blocks/mode'

/**
 * Saves the mode of a draft session, so that the mode of the control is the mode of the first
 * start. After the first message the control is disabled: the agent applies the mode at its start,
 * and a later story changes it in a running session. The input holds the session and the mode only.
 */
export const setMode = defineContract(
  'sessions.set-mode',
  z.strictObject({ id: z.string().min(1), mode: z.enum(MODES) }),
  z.strictObject({}),
  ['unknown-session', 'session-started'],
  {
    valid: [
      { id: 's1', mode: 'ask' },
      { id: 's1', mode: 'approve-all' }
    ],
    invalid: [null, {}, { id: 's1' }, { id: '', mode: 'ask' }, { id: 's1', mode: 'interactive' }, { id: 's1', mode: 'ask', extra: true }]
  }
)

export type SetModeError = (typeof setMode.errors)[number]
