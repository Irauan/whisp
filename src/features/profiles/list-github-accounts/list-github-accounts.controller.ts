import type { GithubPort } from '../../../building-blocks/github.port'
import { listGithubAccountsHandler } from './list-github-accounts.handler'

/** The input is already parsed against the contract. */
export const listGithubAccountsController = (github: GithubPort) => () => listGithubAccountsHandler(github)
