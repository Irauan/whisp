import type { Database } from '../../building-blocks/database'
import { attachmentSchema, sessionSchema, type Session } from './session'
import { z } from 'zod'

const attachmentsSchema = z.array(attachmentSchema)

function toSession(row: Record<string, unknown>): Session {
  return sessionSchema.parse({
    id: row.id,
    profileId: row.profile_id,
    title: row.title,
    prompt: row.prompt,
    mode: row.mode,
    providerId: row.provider_id,
    sourcePath: row.source_path,
    model: row.model,
    attachments: attachmentsSchema.parse(JSON.parse(String(row.attachments))),
    createdAt: row.created_at
  })
}

/** The sessions, in the database. A row that does not match the schema is a defect, so it throws. */
export class SessionStore {
  constructor(private readonly database: Database) {}

  /** The sessions of one profile, oldest first. Two sessions with one creation time keep the order of insertion. */
  listByProfile(profileId: string): Session[] {
    return this.database
      .prepare('SELECT * FROM sessions WHERE profile_id = ? ORDER BY created_at, rowid')
      .all(profileId)
      .map(toSession)
  }

  find(id: string): Session | null {
    const row = this.database.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
    return row ? toSession(row) : null
  }

  /** True when the profile exists. A session needs its profile, so the check comes before an insert. */
  profileExists(profileId: string): boolean {
    return this.database.prepare('SELECT 1 FROM profiles WHERE id = ?').get(profileId) !== undefined
  }

  insert(session: Session): void {
    this.database
      .prepare(
        `INSERT INTO sessions (id, profile_id, provider_id, title, prompt, mode, source_path, model, attachments, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        session.id,
        session.profileId,
        session.providerId,
        session.title,
        session.prompt,
        session.mode,
        session.sourcePath,
        session.model,
        JSON.stringify(session.attachments),
        session.createdAt
      )
  }

  /** Deletes the session. Returns false when it does not exist. */
  remove(id: string): boolean {
    return this.database.prepare('DELETE FROM sessions WHERE id = ?').run(id).changes > 0
  }
}
