import type { Contract } from '../building-blocks/contract'
import { listGithubAccounts } from '../features/workspaces/list-github-accounts/list-github-accounts.contract'

/** The registry. `invoke` accepts only the names of these contracts. */
export const contracts: readonly Contract[] = [listGithubAccounts]

/** The registry of events. `subscribe` accepts only these names. No event exists yet. */
export const events: readonly string[] = []
