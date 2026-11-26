export interface GithubProfile {
  login: string
  name: string | null
  /** A data URL, so that the picture needs no network. */
  avatar: string | null
}

export interface Account {
  id: string
  label: string
  github: GithubProfile | null
}

export const MODES = [
  { id: 'interactive', label: 'Interactive', note: 'Work together step by step' },
  { id: 'plan', label: 'Plan', note: 'Make a plan first, then do the work' },
  { id: 'autopilot', label: 'Autopilot', note: 'Do all the work without a stop' }
] as const

export const PERMISSIONS = [
  { id: 'ask', label: 'Always ask', note: 'Ask before each tool' },
  { id: 'assisted', label: 'Assisted', note: 'Let AI approve the safe tools' },
  { id: 'all', label: 'Approve all', note: 'Run each tool without a question' }
] as const

export const MODELS = [
  { id: 'default', label: 'Default' },
  { id: 'claude-fable-5-2', label: 'Fable 5.2' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' }
] as const

export interface Attachment {
  kind:
    | 'file'
    | 'folder'
    | 'repository-file'
    | 'repository-folder'
    | 'issue'
    | 'pull-request'
    | 'session'
  /** An absolute path, a path in the session folder, a URL, or a session ID. */
  ref: string
  label: string
}

export interface SessionSettings {
  /** The session runs in this folder, and the folder is its context. */
  folder: string
  mode: (typeof MODES)[number]['id']
  permissions: (typeof PERMISSIONS)[number]['id']
  model: (typeof MODELS)[number]['id']
  checkout: 'worktree' | 'folder'
  attachments: Attachment[]
}

export interface Session {
  id: string
  accountId: string
  title: string
  prompt: string
  settings: SessionSettings
  createdAt: string
}

export function labelOf(options: readonly { id: string; label: string }[], id: string): string {
  return options.find((option) => option.id === id)?.label ?? id
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).findLast(Boolean) ?? path
}

export interface Workspace {
  version: 4
  accounts: Account[]
  currentAccountId: string
  /**
   * Old data of projects and work items (decision 0005). Aether does not read it and no action
   * changes it. It stays here so that each save writes back exactly what the load read.
   */
  projects: readonly unknown[]
  workItems: readonly unknown[]
  sessions: Session[]
}

/** The sessions of one account. */
export type AccountContent = Pick<Workspace, 'sessions'>

export type Action =
  | { type: 'account-added'; id: string; label: string; github: GithubProfile | null }
  | { type: 'account-edited'; id: string; label: string; github: GithubProfile | null }
  | { type: 'account-switched'; id: string }
  | { type: 'account-deleted'; id: string }
  | { type: 'session-added'; id: string; prompt: string; settings: SessionSettings; at: string }
  | { type: 'session-deleted'; id: string }

const firstAccount: Account = { id: 'personal', label: 'Personal', github: null }

export const emptyWorkspace: Workspace = {
  version: 4,
  accounts: [firstAccount],
  currentAccountId: firstAccount.id,
  projects: [],
  workItems: [],
  sessions: []
}

export function contentOf(state: Workspace, accountId: string): AccountContent {
  return { sessions: state.sessions.filter((session) => session.accountId === accountId) }
}

export function currentAccount(state: Workspace): Account {
  return state.accounts.find((account) => account.id === state.currentAccountId) ?? firstAccount
}

export function reduce(state: Workspace, action: Action): Workspace {
  switch (action.type) {
    case 'account-added': {
      const { id, label, github } = action
      return { ...state, accounts: [...state.accounts, { id, label, github }], currentAccountId: id }
    }
    case 'account-edited': {
      const { id, label, github } = action
      return {
        ...state,
        accounts: state.accounts.map((account) =>
          account.id === id ? { ...account, label, github } : account
        )
      }
    }
    case 'account-switched':
      return state.accounts.some((account) => account.id === action.id)
        ? { ...state, currentAccountId: action.id }
        : state
    case 'account-deleted': {
      const accounts = state.accounts.filter((account) => account.id !== action.id)
      const [next] = accounts
      // The last account stays, because each session needs an account.
      if (!next) return state
      // The old projects and work items stay as they are. See `Workspace`.
      return {
        ...state,
        accounts,
        currentAccountId: state.currentAccountId === action.id ? next.id : state.currentAccountId,
        sessions: state.sessions.filter((session) => session.accountId !== action.id)
      }
    }
    case 'session-added': {
      const request = parseRequest(action.prompt)
      if (!request) return state
      const session: Session = {
        id: action.id,
        accountId: state.currentAccountId,
        title: request.title,
        prompt: action.prompt,
        settings: action.settings,
        createdAt: action.at
      }
      return { ...state, sessions: [...state.sessions, session] }
    }
    case 'session-deleted':
      return { ...state, sessions: state.sessions.filter((session) => session.id !== action.id) }
  }
}

/** The first line is the title. The other lines are the description. */
export function parseRequest(text: string): { title: string; description: string } | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const [first = '', ...rest] = trimmed.split(/\r?\n/)
  return { title: first.trim(), description: rest.join('\n').trim() }
}

export function isWorkspace(value: unknown): value is Workspace {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<Workspace>
  return (
    candidate.version === 4 &&
    Array.isArray(candidate.accounts) &&
    candidate.accounts.some((account) => account?.id === candidate.currentAccountId) &&
    Array.isArray(candidate.projects) &&
    Array.isArray(candidate.workItems) &&
    Array.isArray(candidate.sessions)
  )
}

/** Version 3 kept only the paths of files in a session. */
function upgradeSession(session: { settings: { files?: string[] } }): unknown {
  const { files = [], ...settings } = session.settings
  const attachments = files.map((path) => ({ kind: 'file', ref: path, label: baseName(path) }))
  return { ...session, settings: { ...settings, attachments } }
}

/** Version 1 had no accounts, so its projects go to the first account. Version 2 had no sessions. */
function upgrade(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  const old = value as Partial<Record<keyof Workspace, unknown>>
  if (old.version === 3 && Array.isArray(old.sessions)) {
    return { ...old, version: 4, sessions: old.sessions.map(upgradeSession) }
  }
  if (old.version === 2) return { ...old, version: 4, sessions: [] }
  if (old.version !== 1 || !Array.isArray(old.projects)) return value
  return {
    ...emptyWorkspace,
    projects: old.projects.map((project: object) => ({ ...project, accountId: firstAccount.id })),
    workItems: old.workItems
  }
}

export function readWorkspace(value: unknown): Workspace | null {
  const upgraded = upgrade(value)
  return isWorkspace(upgraded) ? upgraded : null
}
