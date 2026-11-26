import type { GithubProfile } from '../shared/model'
import type { Result } from './result'

/** Why the port cannot list accounts. */
export type GithubAccountsError = 'github-cli-missing' | 'github-signed-out'

/** The boundary to GitHub. */
export interface GithubPort {
  /** Lists the GitHub accounts that are signed in. It never changes the active account. */
  listAccounts(): Promise<Result<GithubProfile[], GithubAccountsError>>
}
