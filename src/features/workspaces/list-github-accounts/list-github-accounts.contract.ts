import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'

/** A GitHub account that the GitHub CLI is signed in to. */
const profile = z.object({
  login: z.string(),
  name: z.string().nullable(),
  /** A data URL, so that the picture needs no network. */
  avatar: z.string().nullable()
})

/** Lists the GitHub accounts that the GitHub CLI is signed in to. */
export const listGithubAccounts = defineContract(
  'workspaces.list-github-accounts',
  z.strictObject({}),
  z.strictObject({ accounts: z.array(profile) }),
  ['github-cli-missing', 'github-signed-out'],
  {
    valid: [{}],
    invalid: [null, 'not an object', 42, [], { extra: true }]
  }
)

export type ListGithubAccountsError = (typeof listGithubAccounts.errors)[number]
