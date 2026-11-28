import type { ElicitationAnswer } from '../../../building-blocks/agent.port'
import { answerElicitationHandler, type AnswerElicitationDeps } from './answer-elicitation.handler'

/** The input is already parsed against the contract. */
export const answerElicitationController = (deps: AnswerElicitationDeps) => async (input: { id: string; elicitationId: string; answer: ElicitationAnswer }) =>
  answerElicitationHandler(deps, input)
