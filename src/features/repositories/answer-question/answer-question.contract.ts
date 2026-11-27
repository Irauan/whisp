import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'
import { answerSchema, type Answer } from '../question'

export type { Answer }

/**
 * Answers one open question of the main process: the trust question or a directory question. The
 * input holds the session ID, the question ID and one answer. It never holds a path, a profile or
 * a kind: the main process built the question, and it knows what the answer means. The main process
 * refuses an answer that the question does not offer, and ignores a stale one.
 */
export const answerQuestion = defineContract(
  'repositories.answer-question',
  z.strictObject({
    sessionId: z.string().min(1),
    questionId: z.string().min(1),
    answer: answerSchema
  }),
  z.strictObject({}),
  ['unknown-question', 'answer-not-offered'],
  {
    valid: [
      { sessionId: 's1', questionId: 'q1', answer: 'trust' },
      { sessionId: 's1', questionId: 'q1', answer: 'allow-once' },
      { sessionId: 's1', questionId: 'q1', answer: 'allow-always' },
      { sessionId: 's1', questionId: 'q1', answer: 'cancel' }
    ],
    invalid: [
      null,
      {},
      { sessionId: 's1', questionId: 'q1' },
      { sessionId: '', questionId: 'q1', answer: 'trust' },
      { sessionId: 's1', questionId: '', answer: 'trust' },
      { sessionId: 's1', questionId: 'q1', answer: 'allow-forever' },
      { sessionId: 's1', questionId: 'q1', answer: 'trust', path: 'C:\\elsewhere' },
      { sessionId: 's1', questionId: 'q1', answer: 'trust', profileId: 'p1' }
    ]
  }
)

export type AnswerQuestionError = (typeof answerQuestion.errors)[number]
