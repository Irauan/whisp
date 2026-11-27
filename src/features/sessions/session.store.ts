import { z } from 'zod'
import type { Database } from '../../building-blocks/database'
import type { Mode } from '../../building-blocks/mode'
import { entrySchema, isOpenTool, type EntryView } from './entry'
import { attachmentSchema, sessionSchema, type Session } from './session'

const attachmentsSchema = z.array(attachmentSchema)

/** The settings of a provider are a JSON object. The provider of the kind checks the keys. */
const settingsSchema = z.record(z.string(), z.unknown())

export type ProviderSettings = z.output<typeof settingsSchema>

/** What a session keeps about its agent: the provider of its first start, and the agent session to resume. */
export interface AgentState {
  providerId: string | null
  /** The provider settings of the first start. Null until the session has an agent session. */
  providerSnapshot: ProviderSettings | null
  agentSessionId: string | null
}

function toEntry(row: Record<string, unknown>): EntryView {
  return { id: String(row.id), entry: entrySchema.parse(JSON.parse(String(row.data))) }
}

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

  /** The IDs of the sessions of one profile. */
  idsByProfile(profileId: string): string[] {
    return this.database
      .prepare('SELECT id FROM sessions WHERE profile_id = ?')
      .all(profileId)
      .map((row) => String(row.id))
  }

  /** The login of the GitHub account of the profile, or null. */
  githubLoginOf(profileId: string): string | null {
    const row = this.database.prepare('SELECT github_login FROM profiles WHERE id = ?').get(profileId)
    return typeof row?.github_login === 'string' ? row.github_login : null
  }

  /** Saves the mode of a draft. Returns false when the session does not exist. */
  setMode(id: string, mode: Mode): boolean {
    return this.database.prepare('UPDATE sessions SET mode = ? WHERE id = ?').run(mode, id).changes > 0
  }

  agentOf(id: string): AgentState | null {
    const row = this.database
      .prepare('SELECT provider_id, provider_snapshot, agent_session_id FROM sessions WHERE id = ?')
      .get(id)
    if (!row) return null
    return {
      providerId: typeof row.provider_id === 'string' ? row.provider_id : null,
      providerSnapshot: row.provider_snapshot === null ? null : settingsSchema.parse(JSON.parse(String(row.provider_snapshot))),
      agentSessionId: typeof row.agent_session_id === 'string' ? row.agent_session_id : null
    }
  }

  /**
   * The provider row of the profile for this kind. The first start of a session creates it when the
   * profile has none (decision 0013). It is one statement, so two sessions that start together
   * find one row.
   */
  ensureProvider(profileId: string, kind: string, newId: string, createdAt: string): { id: string; settings: ProviderSettings } {
    return this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO providers (id, profile_id, kind, settings, created_at) VALUES (?, ?, ?, '{}', ?)
           ON CONFLICT (profile_id, kind) DO NOTHING`
        )
        .run(newId, profileId, kind, createdAt)
      const row = this.database.prepare('SELECT id, settings FROM providers WHERE profile_id = ? AND kind = ?').get(profileId, kind)
      if (!row) throw new Error('The provider row does not exist.')
      return { id: String(row.id), settings: settingsSchema.parse(JSON.parse(String(row.settings))) }
    })
  }

  /**
   * Saves what the first start of the session fixed: its provider, the settings that the process
   * started with, and the agent session. A later start resumes with these settings (decision 0013).
   */
  saveFirstStart(id: string, start: { providerId: string; snapshot: ProviderSettings; agentSessionId: string }): void {
    this.database
      .prepare('UPDATE sessions SET provider_id = ?, provider_snapshot = ?, agent_session_id = ? WHERE id = ?')
      .run(start.providerId, JSON.stringify(settingsSchema.parse(start.snapshot)), start.agentSessionId, id)
  }

  /** Saves the ID of a new agent session, for example after a resume that failed. */
  saveAgentSession(id: string, agentSessionId: string): void {
    this.database.prepare('UPDATE sessions SET agent_session_id = ? WHERE id = ?').run(agentSessionId, id)
  }

  /** The entries of a session, in order. An entry that does not match the schema is a defect, so it throws. */
  entriesOf(sessionId: string): EntryView[] {
    return this.database.prepare('SELECT id, data FROM entries WHERE session_id = ? ORDER BY position').all(sessionId).map(toEntry)
  }

  entryCount(sessionId: string): number {
    return Number(this.database.prepare('SELECT count(*) AS total FROM entries WHERE session_id = ?').get(sessionId)?.total ?? 0)
  }

  /** The position after the last entry of the session. */
  nextPosition(sessionId: string): number {
    return Number(this.database.prepare('SELECT coalesce(max(position) + 1, 0) AS next FROM entries WHERE session_id = ?').get(sessionId)?.next ?? 0)
  }

  /** Saves one entry. The entry passes the schema first. */
  insertEntry(sessionId: string, view: EntryView, position: number, createdAt: string): void {
    const entry = entrySchema.parse(view.entry)
    this.database
      .prepare('INSERT INTO entries (id, session_id, position, kind, data, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(view.id, sessionId, position, entry.kind, JSON.stringify(entry), createdAt)
  }

  /** Replaces the JSON of an entry. Returns false when the entry does not exist. */
  updateEntry(view: EntryView): boolean {
    const entry = entrySchema.parse(view.entry)
    return this.database.prepare('UPDATE entries SET kind = ?, data = ? WHERE id = ?').run(entry.kind, JSON.stringify(entry), view.id).changes > 0
  }

  /** The tool entry of a call, or null. */
  findTool(sessionId: string, toolId: string): EntryView | null {
    const row = this.database
      .prepare("SELECT id, data FROM entries WHERE session_id = ? AND kind = 'tool' AND json_extract(data, '$.toolId') = ?")
      .get(sessionId, toolId)
    return row ? toEntry(row) : null
  }

  /** The tool entries that did not finish. */
  openTools(sessionId: string): EntryView[] {
    return this.database
      .prepare("SELECT id, data FROM entries WHERE session_id = ? AND kind = 'tool' ORDER BY position")
      .all(sessionId)
      .map(toEntry)
      .filter((view) => isOpenTool(view.entry))
  }
}
