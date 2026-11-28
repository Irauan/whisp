import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'

/**
 * Saves the model of a draft session, so that the model button of the window is the model of the
 * first start. After the first message the button is disabled: the agent fixes the model at its
 * start. The input holds the session and the model only. The model uses the schema of `model` in
 * `sessions.create`: the column stays free text, because the refusal fallback can save an ID that
 * is not in the list of the renderer.
 */
export const setModel = defineContract(
  'sessions.set-model',
  z.strictObject({ id: z.string().min(1), model: z.string().min(1).max(100) }),
  z.strictObject({}),
  ['unknown-session', 'session-started'],
  {
    valid: [
      { id: 's1', model: 'default' },
      { id: 's1', model: 'claude-opus-5-5' }
    ],
    invalid: [
      null,
      {},
      { id: 's1' },
      { model: 'default' },
      { id: '', model: 'default' },
      { id: 's1', model: '' },
      { id: 's1', model: 'x'.repeat(101) },
      { id: 's1', model: 'default', extra: true }
    ]
  }
)

export type SetModelError = (typeof setModel.errors)[number]
