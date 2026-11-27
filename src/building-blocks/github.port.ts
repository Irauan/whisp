import type { GithubProfile } from '../shared/model'
import type { Result } from './result'

/** Why the port cannot list accounts. */
export type GithubAccountsError = 'github-cli-missing' | 'github-signed-out'

/** The boundary to GitHub. */
export interface GithubPort {
  /** Lists the GitHub accounts that are signed in. It never changes the active account. */
  listAccounts(): Promise<Result<GithubProfile[], GithubAccountsError>>
}

/** Why the port cannot give a token. */
export type GithubTokenError = 'github-cli-missing' | 'github-token-missing'

/** The boundary to the token of a GitHub account. Aether stores no token: it reads it for each start of an agent. */
export interface GithubTokenPort {
  /** Reads the token of one account without it becoming the active account. The caller never logs the token. */
  tokenOf(login: string): Promise<Result<string, GithubTokenError>>
}
