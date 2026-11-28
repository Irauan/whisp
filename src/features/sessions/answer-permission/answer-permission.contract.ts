import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'

/**
 * Answers one open permission request of the agent with one of the options that the request offered
 * (spec S5). The answer names the session, the request and the option. It reaches that request only.
 * The main process accepts it for an open request of that session, and only with an offered option.
 */
export const answerPermission = defineContract(
  'sessions.answer-permission',
  z.strictObject({ id: z.string().min(1), requestId: z.string().min(1), optionId: z.string().min(1) }),
  z.strictObject({}),
  ['unknown-session', 'unknown-request', 'unknown-option'],
  {
    valid: [{ id: 's1', requestId: 'r1', optionId: 'allow' }],
    invalid: [
      null,
      {},
      { id: 's1', requestId: 'r1' },
      { id: '', requestId: 'r1', optionId: 'allow' },
      { id: 's1', requestId: '', optionId: 'allow' },
      { id: 's1', requestId: 'r1', optionId: '' },
      { id: 's1', requestId: 'r1', optionId: 1 },
      { id: 's1', requestId: 'r1', optionId: 'allow', extra: true }
    ]
  }
)

export type AnswerPermissionError = (typeof answerPermission.errors)[number]
