import type { Database } from '../../../building-blocks/database'
import type { Mode } from '../../../building-blocks/mode'

const IMPORTED = 'old_files_imported'

export interface DraftRow {
  id: string
  profileId: string
  title: string
  prompt: string
  mode: Mode
  sourcePath: string
  model: string
  attachments: { kind: string; ref: string; label: string }[]
  createdAt: string
}

/** The end of the import, and the session rows that the import writes. */
export class ImportStore {
  constructor(private readonly database: Database) {}

  /** True after an import ended. The import runs once. */
  imported(): boolean {
    return this.database.prepare('SELECT 1 AS found FROM app_state WHERE key = ?').get(IMPORTED) !== undefined
  }

  markImported(at: string): void {
    this.database.prepare('INSERT INTO app_state (key, value) VALUES (?, ?)').run(IMPORTED, at)
  }

  /** Saves the session row, and the folder row of its folder when the profile has none (story S11). */
  insertDraft(draft: DraftRow): void {
    this.database.transaction(() => this.insert(draft))
  }

  private insert(draft: DraftRow): void {
    this.database
      .prepare(
        `INSERT INTO sessions (id, profile_id, title, prompt, mode, source_path, model, attachments, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        draft.id,
        draft.profileId,
        draft.title,
        draft.prompt,
        draft.mode,
        draft.sourcePath,
        draft.model,
        JSON.stringify(draft.attachments),
        draft.createdAt
      )
    // The folder keeps the time of its oldest session, as migration 006 fills it.
    this.database
      .prepare(
        `INSERT INTO folders (id, profile_id, path, created_at) VALUES (lower(hex(randomblob(16))), ?, ?, ?)
         ON CONFLICT (profile_id, path) DO UPDATE SET created_at = min(created_at, excluded.created_at)`
      )
      .run(draft.profileId, draft.sourcePath, draft.createdAt)
  }
}
