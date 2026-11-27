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

/** The text of an error that more than one slice returns. */
export const MESSAGES = {
  unknownProfile: 'This profile does not exist.',
  unknownSession: 'This session does not exist.',
  invalidSourcePath: 'The session folder must be an existing folder, with an absolute path.'
} as const

/** The title of a session: the first line of its prompt, without the space around it. */
export function titleOf(prompt: string): string {
  return (prompt.split(/\r?\n/)[0] ?? '').trim()
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
