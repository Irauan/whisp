import type { Mode } from '../building-blocks/mode'

export interface GithubProfile {
  login: string
  name: string | null
  /** A data URL, so that the picture needs no network. */
  avatar: string | null
}

/**
 * The options of the one Mode control (decision 0012), in the order of the menu. The ids are the
 * modes of the agent port. `src/shared/model.test.ts` checks that they match.
 */
export const MODE_OPTIONS = [
  { id: 'ask', label: 'Ask', note: 'Ask before each tool' },
  { id: 'accept-edits', label: 'Accept edits', note: 'Edit files without a question' },
  { id: 'plan', label: 'Plan', note: 'Make a plan first, change nothing' },
  { id: 'auto', label: 'Auto', note: 'Let a check approve the safe tools' },
  { id: 'approve-all', label: 'Approve all', note: 'Run each tool without a question' }
] as const satisfies readonly { id: Mode; label: string; note: string }[]

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
  mode: Mode
  model: (typeof MODELS)[number]['id']
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
