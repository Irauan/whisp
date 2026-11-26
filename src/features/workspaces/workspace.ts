import { z } from 'zod'

/** The GitHub account that the user chooses. The name and the avatar (a data URL) are for display. Aether keeps no token. */
export const githubAccountInputSchema = z.strictObject({
  login: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/),
  name: z.string().max(200).nullable(),
  avatar: z.string().max(1_000_000).startsWith('data:image/').nullable()
})

/** The GitHub account as saved. The import keeps what the old file held, so the checks are loose. */
export const githubAccountSchema = z.strictObject({
  login: z.string().min(1),
  name: z.string().nullable(),
  avatar: z.string().nullable()
})

export type GithubAccount = z.output<typeof githubAccountSchema>

export const NAME_LIMIT = 40

/** What the user types for a workspace. Each text is trimmed. A blank optional text is null. */
export const workspaceNameSchema = z.string().trim().min(1).max(NAME_LIMIT)
export const rootSchema = z.string().trim().min(1).max(1024)
export const claudeFolderSchema = z.string().trim().min(1).max(1024).nullable()
export const claudeProfileSchema = z.string().trim().min(1).max(100).nullable()

/** One workspace: one usage, with its own root, GitHub account and Claude sign-in (decision 0004). */
export interface Workspace {
  id: string
  name: string
  /** Null until the user chooses it. A workspace of the import starts without a root. */
  root: string | null
  github: GithubAccount | null
  /** The Claude configuration folder (`CLAUDE_CONFIG_DIR`). Aether stores no key and no token. */
  claudeFolder: string | null
  /** The Claude profile name (`ANTHROPIC_PROFILE`). */
  claudeProfile: string | null
  createdAt: string
}

/** The workspace as the renderer sees it. */
export const workspaceViewSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  root: z.string().nullable(),
  github: githubAccountSchema.nullable(),
  claudeFolder: z.string().nullable(),
  claudeProfile: z.string().nullable()
})

export type WorkspaceView = z.output<typeof workspaceViewSchema>

export function viewOf({ id, name, root, github, claudeFolder, claudeProfile }: Workspace): WorkspaceView {
  return { id, name, root, github, claudeFolder, claudeProfile }
}

/** A message for the user about the start of Aether: a file that Aether could not read. */
export const noticeSchema = z.strictObject({
  code: z.enum(['database-unreadable', 'workspace-file-unreadable']),
  message: z.string()
})

export type Notice = z.output<typeof noticeSchema>

/** The text of an error that more than one slice returns. */
export const MESSAGES = {
  invalidRoot: 'The root must be an existing folder, with an absolute path.',
  invalidClaudeFolder: 'The Claude folder must be an absolute path.',
  unknownWorkspace: 'This workspace does not exist.'
} as const
