import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { err, ok, type Result } from '../../building-blocks/result'
import type {
  GithubAccountsError,
  GithubPort,
  GithubTokenError,
  GithubTokenPort
} from '../../building-blocks/github.port'
import type { Listing } from '../../shared/bridge'
import type { Attachment, GithubProfile } from '../../shared/model'

export interface GhOptions {
  /** Runs `gh` without the token variables of Aether, so that a `GH_TOKEN` of Aether cannot answer a token query. */
  withoutTokens?: boolean
}

export type GhRun = (args: string[], token?: string, options?: GhOptions) => Promise<{ stdout: string; missing: boolean }>

/** The variables of the GitHub CLI that hold a token. */
const TOKEN_VARIABLES = /^(GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN)$/i

function environmentOf(token: string | undefined, options: GhOptions | undefined): NodeJS.ProcessEnv {
  if (options?.withoutTokens) {
    return Object.fromEntries(Object.entries(process.env).filter(([name]) => !TOKEN_VARIABLES.test(name)))
  }
  return token ? { ...process.env, GH_TOKEN: token } : process.env
}

/** Runs the GitHub CLI. It never changes the active account. */
export const runGh: GhRun = (args, token, options) =>
  new Promise((resolve) => {
    execFile(
      'gh',
      args,
      {
        cwd: homedir(),
        env: environmentOf(token, options),
        timeout: 15_000,
        windowsHide: true
      },
      // Read the output also on failure: one broken account must not hide the others.
      (error, stdout) => resolve({ stdout, missing: error?.code === 'ENOENT' })
    )
  })

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

/** Reads owner/name from the address of a github.com remote. */
export function parseRemote(address: string): string | null {
  const match = /github\.com[^/:]*[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(address.trim())
  return match ? `${match[1]}/${match[2]}` : null
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

/** Reads the first line of the remote address of a folder. Null means that it has none. */
export type ReadRemote = (folder: string) => Promise<string | null>

/** The GitHub port, through the GitHub CLI (`gh`). */
export class GithubCli implements GithubPort, GithubTokenPort {
  constructor(private readonly run: GhRun = runGh) {}

  async tokenOf(login: string): Promise<Result<string, GithubTokenError>> {
    const { stdout, missing } = await this.run(['auth', 'token', '--hostname', 'github.com', '--user', login], undefined, {
      withoutTokens: true
    })
    if (missing) return err('github-cli-missing', 'The GitHub CLI (gh) is not installed.')
    const token = stdout.trim()
    return token ? ok(token) : err('github-token-missing', `The GitHub CLI has no token for @${login}.`)
  }

  async listAccounts(): Promise<Result<GithubProfile[], GithubAccountsError>> {
    const { stdout, missing } = await this.run(['auth', 'status', '--json', 'hosts'])
    if (missing) return err('github-cli-missing', 'The GitHub CLI (gh) is not installed.')
    const logins = parseLogins(stdout)
    if (logins.length === 0) {
      return err('github-signed-out', 'The GitHub CLI (gh) found no signed-in account.')
    }
    return ok(await Promise.all(logins.map((login) => this.readProfile(login))))
  }

  private async readProfile(login: string): Promise<GithubProfile> {
    try {
      const { stdout } = await this.run(['api', `users/${encodeURIComponent(login)}`])
      const user = JSON.parse(stdout) as { name?: string | null; avatar_url?: string }
      const avatar = user.avatar_url ? await readAvatar(user.avatar_url).catch(() => null) : null
      return { login, name: user.name ?? null, avatar }
    } catch {
      // The login alone is enough to use the account.
      return { login, name: null, avatar: null }
    }
  }

  /** Lists the open issues and pull requests of the repository in the folder. */
  async listIssues(folder: string, login: string | null, readRemote: ReadRemote): Promise<Listing> {
    if (!login) return { ok: false, reason: 'Link a GitHub account in Manage accounts first.' }
    const repository = parseRemote((await readRemote(folder)) ?? '')
    if (!repository) return { ok: false, reason: 'The folder has no github.com remote.' }
    // Keep the token in memory only, and only for these two commands.
    const { stdout } = await this.run(['auth', 'token', '--hostname', 'github.com', '--user', login])
    const token = stdout.trim()
    if (!token) return { ok: false, reason: `The GitHub CLI is not signed in as @${login}.` }
    const [pulls, issues] = await Promise.all([
      this.listOf('pull-request', repository, token),
      this.listOf('issue', repository, token)
    ])
    if (!pulls && !issues) {
      return { ok: false, reason: `@${login} could not read ${repository} on GitHub.` }
    }
    return { ok: true, items: [...(pulls ?? []), ...(issues ?? [])] }
  }

  private async listOf(
    kind: 'issue' | 'pull-request',
    repository: string,
    token: string
  ): Promise<Attachment[] | null> {
    const command = kind === 'issue' ? 'issue' : 'pr'
    const { stdout } = await this.run(
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
}
