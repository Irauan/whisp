import { renameSessionHandler, type RenameSessionDeps } from './rename.handler'

/** The input is already parsed against the contract. */
export const renameSessionController = (deps: RenameSessionDeps) => async (input: { id: string; title: string }) => renameSessionHandler(deps, input)
