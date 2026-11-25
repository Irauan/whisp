import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import type { GithubAccounts, Listing } from '../shared/bridge'
import type { Attachment, GithubProfile } from '../shared/model'
import { git } from './repository'

/** Runs the GitHub CLI. It never changes the active account. */
function gh(args: string[], token?: string): Promise<{ stdout: string; missing: boolean }> {
  return new Promise((resolve) => {
    execFile(
      'gh',
      args,
      {
        cwd: homedir(),
        env: token ? { ...process.env, GH_TOKEN: token } : process.env,
        timeout: 15_000,
        windowsHide: true
      },
      // Read the output also on failure: one broken account must not hide the others.
      (error, stdout) => resolve({ stdout, missing: error?.code === 'ENOENT' })
    )
  })
}

export function parseLogins(text: string): string[] {
  try {
    const { hosts } = JSON.parse(text) as {
      hosts?: Record<string, { login: string; state: string }[]>
    }
    const entries = hosts?.['github.com'] ?? []
    return entries.filter((entry) => entry.state === 'success').map((entry) => entry.login)
  } catch {
    return []
  }
}

async function readAvatar(address: string): Promise<string | null> {
  const url = new URL(address)
  if (url.protocol !== 'https:' || url.hostname !== 'avatars.githubusercontent.com') return null
  url.searchParams.set('s', '96')
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  const type = response.headers.get('content-type') ?? ''
  if (!response.ok || !/^image\/(png|jpeg|gif|webp)$/.test(type)) return null
  return `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`
}

async function readProfile(login: string): Promise<GithubProfile> {
  try {
    const { stdout } = await gh(['api', `users/${encodeURIComponent(login)}`])
    const user = JSON.parse(stdout) as { name?: string | null; avatar_url?: string }
    const avatar = user.avatar_url ? await readAvatar(user.avatar_url).catch(() => null) : null
    return { login, name: user.name ?? null, avatar }
  } catch {
    // The login alone is enough to use the account.
    return { login, name: null, avatar: null }
  }
}

/** Reads owner/name from the address of a github.com remote. */
export function parseRemote(address: string): string | null {
  const match = /github\.com[^/:]*[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(address.trim())
  return match ? `${match[1]}/${match[2]}` : null
}

async function listOf(
  kind: 'issue' | 'pull-request',
  repository: string,
  token: string
): Promise<Attachment[] | null> {
  const command = kind === 'issue' ? 'issue' : 'pr'
  const { stdout } = await gh(
    [command, 'list', '-R', repository, '--limit', '100', '--json', 'number,title,url'],
    token
  )
  try {
    const entries = JSON.parse(stdout) as { number: number; title: string; url: string }[]
    return entries.map(({ number, title, url }) => ({
      kind,
      ref: url,
      label: `#${number} ${title}`
    }))
  } catch {
    return null
  }
}

export async function listIssues(folder: string, login: string | null): Promise<Listing> {
  if (!login) return { ok: false, reason: 'Link a GitHub account in Manage accounts first.' }
  const repository = parseRemote((await git(folder, ['remote', 'get-url', 'origin'])) ?? '')
  if (!repository) return { ok: false, reason: 'The folder has no github.com remote.' }
  // Keep the token in memory only, and only for these two commands.
  const { stdout } = await gh(['auth', 'token', '--hostname', 'github.com', '--user', login])
  const token = stdout.trim()
  if (!token) return { ok: false, reason: `The GitHub CLI is not signed in as @${login}.` }
  const [pulls, issues] = await Promise.all([
    listOf('pull-request', repository, token),
    listOf('issue', repository, token)
  ])
  if (!pulls && !issues) {
    return { ok: false, reason: `@${login} could not read ${repository} on GitHub.` }
  }
  return { ok: true, items: [...(pulls ?? []), ...(issues ?? [])] }
}

export async function listGithubAccounts(): Promise<GithubAccounts> {
  const { stdout, missing } = await gh(['auth', 'status', '--json', 'hosts'])
  if (missing) return { ok: false, reason: 'The GitHub CLI (gh) is not installed.' }
  const logins = parseLogins(stdout)
  if (logins.length === 0) {
    return { ok: false, reason: 'The GitHub CLI (gh) found no signed-in account.' }
  }
  return { ok: true, profiles: await Promise.all(logins.map(readProfile)) }
}
