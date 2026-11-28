import type { Mode } from '../../../building-blocks/mode'
import { setModeHandler, type SetModeDeps } from './set-mode.handler'

/** The input is already parsed against the contract. */
export const setModeController = (deps: SetModeDeps) => async (input: { id: string; mode: Mode }) => setModeHandler(deps, input)
