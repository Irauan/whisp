import { err, ok, type Result } from '../../../building-blocks/result'
import type { Answer } from '../question'
import type { Questions } from '../questions.store'
import type { AnswerQuestionError } from './answer-question.contract'

export interface AnswerQuestionDeps {
  questions: Questions
}

/**
 * Passes the answer of the user to the turn that waits for it. The turn then stores the answer and
 * starts the agent, or refuses. This slice grants nothing itself.
 */
export function answerQuestionHandler(
  { questions }: AnswerQuestionDeps,
  input: { sessionId: string; questionId: string; answer: Answer }
): Result<Record<string, never>, AnswerQuestionError> {
  switch (questions.answer(input.sessionId, input.questionId, input.answer)) {
    case 'answered':
      return ok({})
    case 'not-offered':
      return err('answer-not-offered', 'This question does not offer this answer.')
    case 'unknown':
      return err('unknown-question', 'This question is closed already.')
  }
}
