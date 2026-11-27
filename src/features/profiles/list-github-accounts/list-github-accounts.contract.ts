import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'

/** A GitHub account that the GitHub CLI is signed in to. */
const profile = z.object({
  login: z.string(),
  name: z.string().nullable(),
  /** A data URL, so that the picture needs no network. */
  avatar: z.string().nullable()
})

/**
 * Lists the GitHub accounts that the GitHub CLI is signed in to.
 *
 * The name still says `workspaces`, because the locked tests of m0-gates S8 and the contract test pin it.
 * The user decision of 2026-11-26 renames it to `profiles.list-github-accounts`. Change this one string
 * when the test author has renamed the locked tests.
 */
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
