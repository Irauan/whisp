import { stopHandler, type StopDeps } from './stop.handler'

/** The input is already parsed against the contract. */
export const stopSessionController = (deps: StopDeps) => async (input: { id: string }) => stopHandler(deps, input)
