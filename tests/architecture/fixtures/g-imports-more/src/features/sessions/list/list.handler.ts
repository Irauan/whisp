// Fixture for the other import rules: a slice that imports the app and a root file of
// another feature.
import { wiring } from '../../../app/main/wiring'
import { workspace } from '../../workspaces/workspace'

export const list = [wiring, workspace]
