import type { Database } from '../../building-blocks/database'
import type { Folder } from './folder'

function toFolder(row: Record<string, unknown>): Folder {
  return { id: String(row.id), path: String(row.path), collapsed: row.collapsed === 1 }
}

/** The folders of the profiles, in the database. */
export class FolderStore {
  constructor(private readonly database: Database) {}

  /** Runs `work` as one transaction. */
  transaction<Value>(work: () => Value): Value {
    return this.database.transaction(work)
  }

  /** True when the profile exists. A folder needs its profile, so the check comes before an insert. */
  profileExists(profileId: string): boolean {
    return this.database.prepare('SELECT 1 FROM profiles WHERE id = ?').get(profileId) !== undefined
  }

  /** The folders of one profile, oldest first. */
  listByProfile(profileId: string): Folder[] {
    return this.database
      .prepare('SELECT id, path, collapsed FROM folders WHERE profile_id = ? ORDER BY created_at, rowid')
      .all(profileId)
      .map(toFolder)
  }

  find(id: string): Folder | null {
    const row = this.database.prepare('SELECT id, path, collapsed FROM folders WHERE id = ?').get(id)
    return row ? toFolder(row) : null
  }

  insert(folder: { id: string; profileId: string; path: string; createdAt: string }): void {
    this.database
      .prepare('INSERT INTO folders (id, profile_id, path, created_at) VALUES (?, ?, ?, ?)')
      .run(folder.id, folder.profileId, folder.path, folder.createdAt)
  }

  /** Saves the collapsed state. Returns false when the folder does not exist. */
  setCollapsed(id: string, collapsed: boolean): boolean {
    return this.database.prepare('UPDATE folders SET collapsed = ? WHERE id = ?').run(collapsed ? 1 : 0, id).changes > 0
  }

  /** The number of sessions of the profile that started in the folder. A folder with none can go. */
  sessionCount(id: string): number {
    const row = this.database
      .prepare('SELECT count(*) AS total FROM sessions WHERE (profile_id, source_path) = (SELECT profile_id, path FROM folders WHERE id = ?)')
      .get(id)
    return Number(row?.total ?? 0)
  }

  /** Removes the folder. Returns false when it does not exist. The caller checks that no session uses it. */
  remove(id: string): boolean {
    return this.database.prepare('DELETE FROM folders WHERE id = ?').run(id).changes > 0
  }
}
