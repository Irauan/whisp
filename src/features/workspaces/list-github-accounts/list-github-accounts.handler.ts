import type { GithubPort } from '../../../building-blocks/github.port'
import { ok, type Result } from '../../../building-blocks/result'
import type { ListGithubAccountsError } from './list-github-accounts.contract'

export interface GithubAccounts {
  accounts: { login: string; name: string | null; avatar: string | null }[]
}

export async function listGithubAccountsHandler(
  github: GithubPort
): Promise<Result<GithubAccounts, ListGithubAccountsError>> {
  const result = await github.listAccounts()
  return result.ok ? ok({ accounts: result.value }) : result
}
