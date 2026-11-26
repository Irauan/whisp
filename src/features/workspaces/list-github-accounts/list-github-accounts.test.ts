import { describe, expect, it } from 'vitest'
import type { GithubPort } from '../../../building-blocks/github.port'
import { err, ok } from '../../../building-blocks/result'
import { listGithubAccounts } from './list-github-accounts.contract'
import { listGithubAccountsController } from './list-github-accounts.controller'

const profiles = [
  { login: 'example-one', name: 'Example One', avatar: null },
  { login: 'example-two', name: null, avatar: null }
]

describe('workspaces.list-github-accounts', () => {
  it('returns the accounts of the port', async () => {
    const github: GithubPort = { listAccounts: async () => ok(profiles) }
    const result = await listGithubAccountsController(github)()
    expect(result).toEqual({ ok: true, value: { accounts: profiles } })
    expect(listGithubAccounts.output.safeParse(result).success).toBe(true)
  })

  it('returns the error of the port', async () => {
    const github: GithubPort = { listAccounts: async () => err('github-cli-missing', 'No gh.') }
    const result = await listGithubAccountsController(github)()
    expect(result).toEqual({ ok: false, error: { code: 'github-cli-missing', message: 'No gh.' } })
    expect(listGithubAccounts.output.safeParse(result).success).toBe(true)
  })

  it('accepts only the empty input', () => {
    expect(listGithubAccounts.input.safeParse({}).success).toBe(true)
    expect(listGithubAccounts.input.safeParse({ extra: 1 }).success).toBe(false)
  })
})
