import type { Database } from '../../building-blocks/database'
import type { Ids } from '../../building-blocks/ids'
import type { Profile } from './profile'
import { claudeSettingsOf, parseSettings, type ClaudeChoice } from './provider'

const CURRENT = 'current_profile'
const CLAUDE = 'claude-code'

type Row = Record<string, unknown>

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/** The profile with the settings of its Claude provider row. A settings value that breaks its schema is a defect. */
function toProfile(row: Row): Profile {
  const login = text(row.github_login)
  const settings = row.claude_settings === null ? {} : parseSettings(CLAUDE, JSON.parse(String(row.claude_settings)))
  return {
    id: String(row.id),
    name: String(row.name),
    workspaceDirectory: text(row.workspace_directory),
    github: login === null ? null : { login, name: text(row.github_name), avatar: text(row.github_avatar) },
    claudeFolder: settings.configFolder ?? null,
    claudeProfileName: settings.profileName ?? null,
    createdAt: String(row.created_at)
  }
}

const SELECT = `SELECT p.*, v.settings AS claude_settings
                  FROM profiles p
                  LEFT JOIN providers v ON v.profile_id = p.id AND v.kind = '${CLAUDE}'`

/** The profiles, their Claude provider rows and the current profile, in the database. */
export class ProfileStore {
  constructor(private readonly database: Database) {}

  /** Runs the work as one transaction. */
  transaction<Value>(work: () => Value): Value {
    return this.database.transaction(work)
  }

  /** The profiles in the order that they were added. */
  list(): Profile[] {
    return this.database.prepare(`${SELECT} ORDER BY p.created_at, p.rowid`).all().map(toProfile)
  }

  find(id: string): Profile | null {
    const row = this.database.prepare(`${SELECT} WHERE p.id = ?`).get(id)
    return row ? toProfile(row) : null
  }

  /** Inserts the profile row. The Claude settings are a provider row: see `saveClaude`. */
  insert(profile: Profile): void {
    this.database
      .prepare(
        `INSERT INTO profiles (id, name, workspace_directory, github_login, github_name, github_avatar, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        profile.id,
        profile.name,
        profile.workspaceDirectory,
        profile.github?.login ?? null,
        profile.github?.name ?? null,
        profile.github?.avatar ?? null,
        profile.createdAt
      )
  }

  /** Replaces the name, the workspace directory and the GitHub account. Returns false when the profile does not exist. */
  update(profile: Profile): boolean {
    const { changes } = this.database
      .prepare(
        `UPDATE profiles
            SET name = ?, workspace_directory = ?, github_login = ?, github_name = ?, github_avatar = ?
          WHERE id = ?`
      )
      .run(
        profile.name,
        profile.workspaceDirectory,
        profile.github?.login ?? null,
        profile.github?.name ?? null,
        profile.github?.avatar ?? null,
        profile.id
      )
    return changes > 0
  }

  /** Saves the Claude settings of a profile in its provider row. See `saveProvider`. */
  saveClaude(profileId: string, choice: ClaudeChoice, ids: Ids, createdAt: string): void {
    this.saveProvider(profileId, CLAUDE, claudeSettingsOf(choice), ids, createdAt)
  }

  /**
   * Saves the settings of the provider of this kind. Each profile has one row for each kind, and a
   * change edits that row in place. The settings pass through the schema of the kind, so an unknown
   * kind and a setting that the schema does not know throw. A session keeps the ID of its provider,
   * so the row stays when the user clears all settings: it then holds an empty object. Without a
   * row and without a setting, no row is made.
   */
  saveProvider(profileId: string, kind: string, settings: unknown, ids: Ids, createdAt: string): void {
    const checked = parseSettings(kind, settings)
    const json = JSON.stringify(checked)
    const changed = this.database
      .prepare('UPDATE providers SET settings = ? WHERE profile_id = ? AND kind = ?')
      .run(json, profileId, kind).changes
    if (changed === 0 && Object.keys(checked).length > 0) {
      this.database
        .prepare('INSERT INTO providers (id, profile_id, kind, settings, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(ids.next(), profileId, kind, json, createdAt)
    }
  }

  setWorkspaceDirectory(id: string, workspaceDirectory: string): boolean {
    return this.database.prepare('UPDATE profiles SET workspace_directory = ? WHERE id = ?').run(workspaceDirectory, id).changes > 0
  }

  /** Removes a profile and, with it, its providers and its sessions. The current profile falls back to the first. */
  remove(id: string): boolean {
    return this.transaction(() => {
      this.database.prepare('DELETE FROM app_state WHERE key = ? AND value = ?').run(CURRENT, id)
      return this.database.prepare('DELETE FROM profiles WHERE id = ?').run(id).changes > 0
    })
  }

  /** The ID of the current profile: the saved choice, or the first profile. Null without profiles. */
  currentId(): string | null {
    const row = this.database
      .prepare(
        `SELECT id FROM profiles
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
