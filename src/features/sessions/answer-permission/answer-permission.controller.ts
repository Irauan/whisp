import { answerPermissionHandler, type AnswerPermissionDeps } from './answer-permission.handler'

/** The input is already parsed against the contract. */
export const answerPermissionController = (deps: AnswerPermissionDeps) => async (input: { id: string; requestId: string; optionId: string }) =>
  answerPermissionHandler(deps, input)
