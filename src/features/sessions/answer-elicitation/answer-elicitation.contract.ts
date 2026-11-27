import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'

/**
 * Answers one open form of the agent, a question of Claude (spec S5). The user submits the picks and the
 * texts, or skips the whole form. The main process checks each value against the fields of the form.
 */
export const answerElicitation = defineContract(
  'sessions.answer-elicitation',
  z.strictObject({
    id: z.string().min(1),
    elicitationId: z.string().min(1),
    answer: z.discriminatedUnion('action', [
      z.strictObject({ action: z.literal('submit'), values: z.record(z.string(), z.union([z.string(), z.array(z.string())])) }),
      z.strictObject({ action: z.literal('skip') })
    ])
  }),
  z.strictObject({}),
  ['unknown-session', 'unknown-request', 'invalid-answer'],
  {
    valid: [
      { id: 's1', elicitationId: 'e1', answer: { action: 'skip' } },
      { id: 's1', elicitationId: 'e1', answer: { action: 'submit', values: { question_0: 'Vitest', question_1: ['A', 'B'] } } }
    ],
    invalid: [
      null,
      {},
      { id: 's1', elicitationId: 'e1' },
      { id: '', elicitationId: 'e1', answer: { action: 'skip' } },
      { id: 's1', elicitationId: '', answer: { action: 'skip' } },
      { id: 's1', elicitationId: 'e1', answer: { action: 'cancel' } },
      { id: 's1', elicitationId: 'e1', answer: { action: 'submit' } },
      { id: 's1', elicitationId: 'e1', answer: { action: 'submit', values: { question_0: 1 } } },
      { id: 's1', elicitationId: 'e1', answer: { action: 'skip' }, extra: true }
    ]
  }
)

export type AnswerElicitationError = (typeof answerElicitation.errors)[number]
