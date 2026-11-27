import { setModelHandler, type SetModelDeps } from './set-model.handler'

/** The input is already parsed against the contract. */
export const setModelController = (deps: SetModelDeps) => async (input: { id: string; model: string }) => setModelHandler(deps, input)
