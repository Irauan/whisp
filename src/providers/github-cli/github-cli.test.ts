import { expect, it } from 'vitest'
import { GithubCli, parseLogins, parseRemote, type GhRun } from './github-cli'

it('lists the working accounts of github.com', () => {
  const status = {
    hosts: {
      'github.com': [
        { login: 'home', state: 'success' },
        { login: 'expired', state: 'error' },
        { login: 'work', state: 'success' }
      ],
      'github.example.com': [{ login: 'other', state: 'success' }]
    }
  }
  expect(parseLogins(JSON.stringify(status))).toEqual(['home', 'work'])
})

it('reads the repository from a remote address', () => {
  expect(parseRemote('git@github.com:me/app.git\n')).toBe('me/app')
  expect(parseRemote('https://github.com/me/my.app')).toBe('me/my.app')
  expect(parseRemote('git@github.com-work:me/app.git')).toBe('me/app')
  expect(parseRemote('https://gitlab.com/me/app')).toBeNull()
  expect(parseRemote('')).toBeNull()
})

it('lists nothing for other output', () => {
  expect(parseLogins('')).toEqual([])
  expect(parseLogins('{}')).toEqual([])
})

const status = JSON.stringify({
  hosts: {
    'github.com': [
      { login: 'example-one', state: 'success' },
      { login: 'example-two', state: 'success' }
    ]
  }
})

/** A fake `gh`: each answer is the output for the arguments joined with a space. */
const fakeGh =
  (answers: Record<string, string>, calls: string[] = []): GhRun =>
  async (args) => {
    const line = args.join(' ')
    calls.push(line)
    return { stdout: answers[line] ?? '', missing: false }
  }

it('returns the profile of each signed-in account', async () => {
  const github = new GithubCli(
    fakeGh({
      'auth status --json hosts': status,
      'api users/example-one': JSON.stringify({ login: 'example-one', name: 'Example One' }),
      'api users/example-two': JSON.stringify({ login: 'example-two', name: null })
    })
  )
  expect(await github.listAccounts()).toEqual({
    ok: true,
    value: [
      { login: 'example-one', name: 'Example One', avatar: null },
      { login: 'example-two', name: null, avatar: null }
    ]
  })
})

it('keeps the login of an account whose profile cannot be read', async () => {
  const github = new GithubCli(fakeGh({ 'auth status --json hosts': status }))
  const result = await github.listAccounts()
  expect(result).toEqual({
    ok: true,
    value: [
      { login: 'example-one', name: null, avatar: null },
      { login: 'example-two', name: null, avatar: null }
    ]
  })
})

it('returns github-cli-missing when gh is not installed', async () => {
  const github = new GithubCli(async () => ({ stdout: '', missing: true }))
  expect(await github.listAccounts()).toMatchObject({ ok: false, error: { code: 'github-cli-missing' } })
})

it('returns github-signed-out when gh has no working account', async () => {
  const github = new GithubCli(fakeGh({ 'auth status --json hosts': '{}' }))
  expect(await github.listAccounts()).toMatchObject({ ok: false, error: { code: 'github-signed-out' } })
})

it('lists no issues without a linked account', async () => {
  const github = new GithubCli(fakeGh({}))
  const listing = await github.listIssues('C:/repo', null, async () => 'git@github.com:me/app.git')
  expect(listing).toEqual({ ok: false, reason: 'Link a GitHub account in Manage accounts first.' })
})

it('lists no issues for a folder without a github.com remote', async () => {
  const github = new GithubCli(fakeGh({}))
  const listing = await github.listIssues('C:/repo', 'example-one', async () => null)
  expect(listing).toEqual({ ok: false, reason: 'The folder has no github.com remote.' })
})

it('lists the pull requests and issues of the repository with the token of the account', async () => {
  const calls: string[] = []
  const github = new GithubCli(
    fakeGh(
      {
        'auth token --hostname github.com --user example-one': 'fake-token\n',
        'pr list -R me/app --limit 100 --json number,title,url': JSON.stringify([
          { number: 2, title: 'Add it', url: 'https://github.com/me/app/pull/2' }
        ]),
        'issue list -R me/app --limit 100 --json number,title,url': JSON.stringify([
          { number: 1, title: 'Fix it', url: 'https://github.com/me/app/issues/1' }
        ])
      },
      calls
    )
  )
  const listing = await github.listIssues('C:/repo', 'example-one', async () => 'git@github.com:me/app.git')
  expect(listing).toEqual({
    ok: true,
    items: [
      { kind: 'pull-request', ref: 'https://github.com/me/app/pull/2', label: '#2 Add it' },
      { kind: 'issue', ref: 'https://github.com/me/app/issues/1', label: '#1 Fix it' }
    ]
  })
})
