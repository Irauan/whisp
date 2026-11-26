import { z } from 'zod'
import { MODES } from '../../building-blocks/mode'

/** One attachment of a session: a file, a folder, a repository file, an issue and so on. */
export const attachmentSchema = z.strictObject({
  kind: z.string().min(1),
  /** An absolute path, a path in the session folder, a URL, or a session ID. */
  ref: z.string(),
  label: z.string()
})

export type Attachment = z.output<typeof attachmentSchema>

/**
 * One session of a workspace. In this version a session is a draft, created by the import of the
 * old `workspace.json`. The prompt waits in the composer. A later story starts the session.
 */
export const sessionSchema = z.strictObject({
  id: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  prompt: z.string(),
  mode: z.enum(MODES),
  folder: z.string(),
  model: z.string(),
  attachments: z.array(attachmentSchema),
  createdAt: z.string()
})

export type Session = z.output<typeof sessionSchema>
