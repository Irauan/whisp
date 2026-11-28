import { z } from 'zod'
import { MODES, type Mode } from '../../building-blocks/mode'

/** One attachment of a session: a file, a folder, a repository file, an issue and so on. */
export const attachmentSchema = z.strictObject({
  kind: z.string().min(1),
  /** An absolute path, a path in the session folder, a URL, or a session ID. */
  ref: z.string(),
  label: z.string()
})

export type Attachment = z.output<typeof attachmentSchema>

/** The attachment kinds that become a link to a file or a folder in the first message. */
export const FILE_KINDS = ['file', 'folder', 'repository-file', 'repository-folder'] as const

/** The attachment kinds that give a URL, which the first message holds as text. */
export const URL_KINDS = ['issue', 'pull-request'] as const

const isFileKind = (kind: string): boolean => (FILE_KINDS as readonly string[]).includes(kind)
const isUrlKind = (kind: string): boolean => (URL_KINDS as readonly string[]).includes(kind)

/**
 * The reason that Aether cannot send the attachments, or null when it can. The first attachment
 * that fails gives the reason: a kind that Aether does not know, or a session (coming soon).
 */
export function unsupportedAttachment(attachments: readonly Attachment[]): string | null {
  for (const { kind, label } of attachments) {
    if (kind === 'session') return `The session attachment "${label}" is coming soon. Aether cannot start a session with it.`
    if (!isFileKind(kind) && !isUrlKind(kind)) {
      return `Aether cannot send the attachment "${label}": it does not know the kind "${kind}".`
    }
  }
  return null
}

/** The text of the first message for the agent: the text of the user, then the URL of each issue and pull request. */
export function textForAgent(text: string, attachments: readonly Attachment[]): string {
  const urls = attachments.filter(({ kind }) => isUrlKind(kind)).map(({ ref }) => ref)
  return urls.length === 0 ? text : `${text}\n\nReferences:\n${urls.join('\n')}`
}

/**
 * One session of a profile. In this version a session is a draft: the import of the old
 * `workspace.json` or the user creates it, and the prompt waits in the composer. A later story
 * starts the session.
 */
export const sessionSchema = z.strictObject({
  id: z.string(),
  profileId: z.string(),
  title: z.string(),
  prompt: z.string(),
  mode: z.enum(MODES),
  providerId: z.string().nullable(),
  /** The repository or folder that the session started from. The sidebar groups sessions by it. */
  sourcePath: z.string(),
  model: z.string(),
  attachments: z.array(attachmentSchema),
  createdAt: z.string()
})

export type Session = z.output<typeof sessionSchema>

/**
 * Who started a session (decision 0006, `sessions.started_by`). The release time depends on it.
 * It is not part of `Session`: the renderer neither reads nor sets it. No code writes `automation` in m1.
 */
export const starterSchema = z.enum(['person', 'automation'])

export type Starter = z.output<typeof starterSchema>

/**
 * Where the title of a session comes from (`sessions.title_source`, migration 005): the first line of
 * the first message, the agent, or the user. A title of the agent never replaces a title of the user.
 * The database holds no CHECK for it: the store validates the value. The renderer neither reads nor sets it.
 */
export const titleSourceSchema = z.enum(['prompt', 'agent', 'user'])

export type TitleSource = z.output<typeof titleSourceSchema>

/** The text of an error that more than one slice returns. */
export const MESSAGES = {
  unknownProfile: 'This profile does not exist.',
  unknownSession: 'This session does not exist.',
  invalidSourcePath: 'The session folder must be an existing folder, with an absolute path.',
  folderMissing: 'The session folder does not exist any more. Create it again, or start a new session in another folder.',
  turnActive: 'The agent is still working on the last message.',
  sessionStarted: 'The mode of a session that started cannot change here.',
  blankTitle: 'The title needs some text.',
  draftTitle: 'A session that has not started has no title to change.'
} as const

/** The kind of provider that every session uses now (decision 0013). */
export const PROVIDER_KIND = 'claude-code'

/** The longest title of a session, in characters. */
export const TITLE_LIMIT = 100

/**
 * The title of a session: the first line of its prompt, without the space around it. A long line
 * is cut at `TITLE_LIMIT` characters. The cut never splits a character in two.
 */
export function titleOf(prompt: string): string {
  const line = (prompt.split(/\r?\n/)[0] ?? '').trim()
  return [...line].slice(0, TITLE_LIMIT).join('').trimEnd()
}

/**
 * The mode that a new session starts with (decision 0012). It is the mode of the newest created
 * session of the profile. Approve all is never copied: it becomes Ask. A profile without
 * sessions starts with Ask. When two sessions share a creation time, the later one in the list wins.
 */
export function modeForNewSession(sessions: readonly Pick<Session, 'mode' | 'createdAt'>[]): Mode {
  let newest: Pick<Session, 'mode' | 'createdAt'> | undefined
  for (const session of sessions) {
    if (!newest || session.createdAt >= newest.createdAt) newest = session
  }
  return newest === undefined || newest.mode === 'approve-all' ? 'ask' : newest.mode
}
