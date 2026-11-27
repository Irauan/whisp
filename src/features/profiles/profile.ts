import { z } from 'zod'

/** The GitHub account that the user chooses. The name and the avatar (a data URL) are for display. Aether keeps no token. */
export const githubAccountInputSchema = z.strictObject({
  // GitHub allows letters, digits and hyphens. A managed user of an enterprise also has an underscore.
  // The check stays loose: a name with no space and at most 100 characters.
  login: z.string().min(1).max(100).regex(/^\S+$/),
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

/** What the user types for a profile. Each text is trimmed. A blank optional text is null. */
export const profileNameSchema = z.string().trim().min(1).max(NAME_LIMIT)
export const workspaceDirectorySchema = z.string().trim().min(1).max(1024)
export const claudeFolderSchema = z.string().trim().min(1).max(1024).nullable()
export const claudeProfileNameSchema = z.string().trim().min(1).max(100).nullable()

/**
 * One profile: one usage, with its own workspace directory and GitHub account (decisions 0004 and
 * 0013). The Claude settings come from the provider row of the profile.
 */
export interface Profile {
  id: string
  name: string
  /** The folder that holds the repositories. Null until the user chooses it. A profile of the import starts without one. */
  workspaceDirectory: string | null
  github: GithubAccount | null
  /** The Claude configuration folder (`CLAUDE_CONFIG_DIR`) of the provider `claude-code`. */
  claudeFolder: string | null
  /** The Claude profile name (`ANTHROPIC_PROFILE`) of the provider `claude-code`. */
  claudeProfileName: string | null
  createdAt: string
}

/** The profile as the renderer sees it. */
export const profileViewSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  workspaceDirectory: z.string().nullable(),
  github: githubAccountSchema.nullable(),
  claudeFolder: z.string().nullable(),
  claudeProfileName: z.string().nullable()
})

export type ProfileView = z.output<typeof profileViewSchema>

export function viewOf({ id, name, workspaceDirectory, github, claudeFolder, claudeProfileName }: Profile): ProfileView {
  return { id, name, workspaceDirectory, github, claudeFolder, claudeProfileName }
}

/** A message for the user about the start of Aether: a file that Aether could not read. */
export const noticeSchema = z.strictObject({
  code: z.enum(['database-unreadable', 'workspace-file-unreadable']),
  message: z.string()
})

export type Notice = z.output<typeof noticeSchema>

/** The text of an error that more than one slice returns. */
export const MESSAGES = {
  invalidWorkspaceDirectory: 'The workspace directory must be an existing folder, with an absolute path.',
  invalidClaudeFolder: 'The Claude folder must be an absolute path.',
  unknownProfile: 'This profile does not exist.'
} as const
