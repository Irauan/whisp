import type { Database } from '../../../building-blocks/database'
import type { Mode } from '../../../building-blocks/mode'

const IMPORTED = 'old_files_imported'

export interface DraftRow {
  id: string
  workspaceId: string
  title: string
  prompt: string
  mode: Mode
  folder: string
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

  insertDraft(draft: DraftRow): void {
    this.database
      .prepare(
        `INSERT INTO sessions (id, workspace_id, title, prompt, mode, folder, model, attachments, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        draft.id,
        draft.workspaceId,
        draft.title,
        draft.prompt,
        draft.mode,
        draft.folder,
        draft.model,
        JSON.stringify(draft.attachments),
        draft.createdAt
      )
  }
}
