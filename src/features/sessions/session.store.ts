import { z } from 'zod'
import type { Database } from '../../building-blocks/database'
import type { Mode } from '../../building-blocks/mode'
import { entrySchema, isOpenTool, type EntryView } from './entry'
import { attachmentSchema, sessionSchema, type Session } from './session'

const attachmentsSchema = z.array(attachmentSchema)

/** The name of an account that Aether creates. The user can change it. */
const DEFAULT_LABEL = 'Claude'

/** The settings of a provider are a JSON object. The provider of the kind checks the keys. */
const settingsSchema = z.record(z.string(), z.unknown())

export type ProviderSettings = z.output<typeof settingsSchema>

/** One agent run of a session: the agent session that Aether resumes, and the account that it runs with. */
export interface AgentRun {
  /** The ID of the row in `agent_sessions`. */
  id: string
  providerId: string
  /** The settings of the account of the run. The account of a run keeps its Claude folder. */
  settings: ProviderSettings
  /** The ID that the agent gave to its session. */
  externalId: string
}

/** An account of a profile. */
export interface ProviderAccount {
  id: string
  settings: ProviderSettings
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

  /** The newest agent run of the session, with the settings of its account. Null before the first start. */
  agentRunOf(sessionId: string): AgentRun | null {
    const row = this.database
      .prepare(
        `SELECT a.id, a.provider_id, a.external_id, p.settings
           FROM agent_sessions a JOIN providers p ON p.id = a.provider_id
          WHERE a.session_id = ? ORDER BY a.created_at DESC, a.rowid DESC LIMIT 1`
      )
      .get(sessionId)
    if (!row) return null
    return {
      id: String(row.id),
      providerId: String(row.provider_id),
      settings: settingsSchema.parse(JSON.parse(String(row.settings))),
      externalId: String(row.external_id)
    }
  }

  /** The account with this ID, or null. */
  providerById(id: string): ProviderAccount | null {
    const row = this.database.prepare('SELECT id, settings FROM providers WHERE id = ?').get(id)
    return row ? { id: String(row.id), settings: settingsSchema.parse(JSON.parse(String(row.settings))) } : null
  }

  /** The current account of the profile for this kind, or null (decision 0014). */
  currentProvider(profileId: string, kind: string): ProviderAccount | null {
    const row = this.database.prepare('SELECT id, settings FROM providers WHERE profile_id = ? AND kind = ? AND is_current = 1').get(profileId, kind)
    return row ? { id: String(row.id), settings: settingsSchema.parse(JSON.parse(String(row.settings))) } : null
  }

  /**
   * The current account of the profile for this kind. The first start of a session creates an empty
   * account when the profile has none (decision 0014). It is one synchronous transaction, so two
   * sessions that start together find one account.
   */
  ensureCurrentProvider(profileId: string, kind: string, newId: string, createdAt: string): ProviderAccount {
    return this.database.transaction(() => {
      const found = this.currentProvider(profileId, kind)
      if (found) return found
      this.database
        .prepare("INSERT INTO providers (id, profile_id, kind, label, settings, is_current, created_at) VALUES (?, ?, ?, ?, '{}', 1, ?)")
        .run(newId, profileId, kind, DEFAULT_LABEL, createdAt)
      return { id: newId, settings: {} }
    })
  }

  /**
   * Saves the first agent run of the session in one transaction: its row in `agent_sessions`, and the
   * account of the session when the session had none. A later start resumes with the account of the run.
   */
  saveFirstRun(sessionId: string, run: { id: string; providerId: string; externalId: string; createdAt: string }): void {
    this.database.transaction(() => {
      this.database
        .prepare('INSERT INTO agent_sessions (id, session_id, provider_id, external_id, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(run.id, sessionId, run.providerId, run.externalId, run.createdAt)
      this.database.prepare('UPDATE sessions SET provider_id = ? WHERE id = ? AND provider_id IS NULL').run(run.providerId, sessionId)
    })
  }

  /** Saves the ID of a new agent session in the run, for example after a resume that failed. */
  saveExternalId(runId: string, externalId: string): void {
    this.database.prepare('UPDATE agent_sessions SET external_id = ? WHERE id = ?').run(externalId, runId)
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

  /**
   * The tool entry of a call in the turn that runs, or null. A turn starts at the last entry of the
   * user. An agent can reuse a call ID in the next turn, so an earlier turn never matches.
   */
  findTool(sessionId: string, toolId: string): EntryView | null {
    const row = this.database
      .prepare(
        `SELECT id, data FROM entries
          WHERE session_id = ? AND kind = 'tool' AND json_extract(data, '$.toolId') = ?
            AND position > coalesce((SELECT max(position) FROM entries WHERE session_id = ? AND kind = 'user'), -1)`
      )
      .get(sessionId, toolId, sessionId)
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
