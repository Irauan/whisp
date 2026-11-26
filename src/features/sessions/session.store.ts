import type { Database } from '../../building-blocks/database'
import { attachmentSchema, sessionSchema, type Session } from './session'
import { z } from 'zod'

const attachmentsSchema = z.array(attachmentSchema)

function toSession(row: Record<string, unknown>): Session {
  return sessionSchema.parse({
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    prompt: row.prompt,
    mode: row.mode,
    folder: row.folder,
    model: row.model,
    attachments: attachmentsSchema.parse(JSON.parse(String(row.attachments))),
    createdAt: row.created_at
  })
}

/** The sessions, in the database. A row that does not match the schema is a defect, so it throws. */
export class SessionStore {
  constructor(private readonly database: Database) {}

  /** The sessions of one workspace, oldest first. */
  listByWorkspace(workspaceId: string): Session[] {
    return this.database
      .prepare('SELECT * FROM sessions WHERE workspace_id = ? ORDER BY created_at, rowid')
      .all(workspaceId)
      .map(toSession)
  }
}
