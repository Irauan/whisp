export interface GithubProfile {
  login: string
  name: string | null
  /** A data URL, so that the picture needs no network. */
  avatar: string | null
}

// The options of the composer. m1-chat S3 replaces Mode and Tool permissions with one Mode control.
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

/** What the user chooses in the composer for a new session. */
export interface SessionSettings {
  /** The session runs in this folder, and the folder is its context. */
  folder: string
  mode: (typeof MODES)[number]['id']
  permissions: (typeof PERMISSIONS)[number]['id']
  model: (typeof MODELS)[number]['id']
  checkout: 'worktree' | 'folder'
  attachments: Attachment[]
}

export function labelOf(options: readonly { id: string; label: string }[], id: string): string {
  return options.find((option) => option.id === id)?.label ?? id
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).findLast(Boolean) ?? path
}

/** The first line is the title. The other lines are the description. */
export function parseRequest(text: string): { title: string; description: string } | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const [first = '', ...rest] = trimmed.split(/\r?\n/)
  return { title: first.trim(), description: rest.join('\n').trim() }
}
