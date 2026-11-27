import type { Answer } from '../question'
import { answerQuestionHandler, type AnswerQuestionDeps } from './answer-question.handler'

/** The input is already parsed against the contract. */
export const answerQuestionController =
  (deps: AnswerQuestionDeps) => async (input: { sessionId: string; questionId: string; answer: Answer }) =>
    answerQuestionHandler(deps, input)
