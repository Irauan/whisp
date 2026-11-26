import type { Contract } from '../building-blocks/contract'
import { listSessions } from '../features/sessions/list/list.contract'
import { addWorkspace } from '../features/workspaces/add/add.contract'
import { chooseRoots } from '../features/workspaces/choose-roots/choose-roots.contract'
import { editWorkspace } from '../features/workspaces/edit/edit.contract'
import { listGithubAccounts } from '../features/workspaces/list-github-accounts/list-github-accounts.contract'
import { listWorkspaces } from '../features/workspaces/list/list.contract'
import { removeWorkspace } from '../features/workspaces/remove/remove.contract'
import { switchWorkspace } from '../features/workspaces/switch/switch.contract'

/** The registry. `invoke` accepts only the names of these contracts. */
export const contracts: readonly Contract[] = [
  listGithubAccounts,
  listWorkspaces,
  chooseRoots,
  addWorkspace,
  editWorkspace,
  switchWorkspace,
  removeWorkspace,
  listSessions
]

/** The registry of events. `subscribe` accepts only these names. No event exists yet. */
export const events: readonly string[] = []
