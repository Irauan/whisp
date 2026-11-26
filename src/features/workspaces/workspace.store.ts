import type { Database } from '../../building-blocks/database'
import type { Workspace } from './workspace'

const CURRENT = 'current_workspace'

type Row = Record<string, unknown>

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

function toWorkspace(row: Row): Workspace {
  const login = text(row.github_login)
  return {
    id: String(row.id),
    name: String(row.name),
    root: text(row.root),
    github: login === null ? null : { login, name: text(row.github_name), avatar: text(row.github_avatar) },
    claudeFolder: text(row.claude_folder),
    claudeProfile: text(row.claude_profile),
    createdAt: String(row.created_at)
  }
}

/** The workspaces and the current workspace, in the database. */
export class WorkspaceStore {
  constructor(private readonly database: Database) {}

  /** Runs the work as one transaction. */
  transaction<Value>(work: () => Value): Value {
    return this.database.transaction(work)
  }

  /** The workspaces in the order that they were added. */
  list(): Workspace[] {
    return this.database.prepare('SELECT * FROM workspaces ORDER BY created_at, rowid').all().map(toWorkspace)
  }

  find(id: string): Workspace | null {
    const row = this.database.prepare('SELECT * FROM workspaces WHERE id = ?').get(id)
    return row ? toWorkspace(row) : null
  }

  insert(workspace: Workspace): void {
    this.database
      .prepare(
        `INSERT INTO workspaces
           (id, name, root, github_login, github_name, github_avatar, claude_folder, claude_profile, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        workspace.id,
        workspace.name,
        workspace.root,
        workspace.github?.login ?? null,
        workspace.github?.name ?? null,
        workspace.github?.avatar ?? null,
        workspace.claudeFolder,
        workspace.claudeProfile,
        workspace.createdAt
      )
  }

  /** Replaces the settings of a workspace. Returns false when it does not exist. */
  update(workspace: Workspace): boolean {
    const { changes } = this.database
      .prepare(
        `UPDATE workspaces
            SET name = ?, root = ?, github_login = ?, github_name = ?, github_avatar = ?,
                claude_folder = ?, claude_profile = ?
          WHERE id = ?`
      )
      .run(
        workspace.name,
        workspace.root,
        workspace.github?.login ?? null,
        workspace.github?.name ?? null,
        workspace.github?.avatar ?? null,
        workspace.claudeFolder,
        workspace.claudeProfile,
        workspace.id
      )
    return changes > 0
  }

  setRoot(id: string, root: string): boolean {
    return this.database.prepare('UPDATE workspaces SET root = ? WHERE id = ?').run(root, id).changes > 0
  }

  /** Removes a workspace and, with it, its sessions. The current workspace falls back to the first. */
  remove(id: string): boolean {
    return this.transaction(() => {
      this.database.prepare('DELETE FROM app_state WHERE key = ? AND value = ?').run(CURRENT, id)
      return this.database.prepare('DELETE FROM workspaces WHERE id = ?').run(id).changes > 0
    })
  }

  /** The ID of the current workspace: the saved choice, or the first workspace. Null without workspaces. */
  currentId(): string | null {
    const row = this.database
      .prepare(
        `SELECT id FROM workspaces
          ORDER BY (id = (SELECT value FROM app_state WHERE key = ?)) DESC, created_at, rowid
          LIMIT 1`
      )
      .get(CURRENT)
    return row ? String(row.id) : null
  }

  setCurrent(id: string): void {
    this.database
      .prepare('INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
      .run(CURRENT, id)
  }
}
