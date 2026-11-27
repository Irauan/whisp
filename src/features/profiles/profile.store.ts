import { AccountsInStart } from '../../building-blocks/accounts-in-start'
import type { Database } from '../../building-blocks/database'
import type { Ids } from '../../building-blocks/ids'
import type { Profile } from './profile'
import { claudeSettingsOf, parseSettings, type ClaudeChoice, type ClaudeCodeSettings } from './provider'

const CURRENT = 'current_profile'
const CLAUDE = 'claude-code'

/** The name of the account that Aether creates. The user can change it. */
const DEFAULT_LABEL = 'Claude'

type Row = Record<string, unknown>

/** The settings as JSON with a fixed order of the keys, so that equal settings give equal text. */
const canonical = (settings: ClaudeCodeSettings): string =>
  JSON.stringify(Object.fromEntries(Object.entries(settings).sort(([a], [b]) => a.localeCompare(b))))

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/** The profile with the settings of its current Claude account. A settings value that breaks its schema is a defect. */
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
                  LEFT JOIN providers v ON v.profile_id = p.id AND v.kind = '${CLAUDE}' AND v.is_current = 1`

/** The profiles, their current Claude accounts and the current profile, in the database. */
export class ProfileStore {
  /**
   * @param starting The accounts that a first start uses now. An account in it counts as used, so
   *   an edit makes a new current account (decision 0014). Without it, no account is in a start.
   */
  constructor(
    private readonly database: Database,
    private readonly starting: AccountsInStart = new AccountsInStart()
  ) {}

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

  /** Saves the Claude settings of a profile in its current Claude account. See `saveProvider`. */
  saveClaude(profileId: string, choice: ClaudeChoice, ids: Ids, createdAt: string): void {
    this.saveProvider(profileId, CLAUDE, claudeSettingsOf(choice), ids, createdAt)
  }

  /**
   * Saves the settings of the current account of this kind (decision 0014). The settings pass
   * through the schema of the kind, so an unknown kind and a setting that the schema does not know throw.
   *
   * - Same settings: nothing changes.
   * - No account and no setting: no row is made.
   * - No account: the settings make the current account.
   * - An account that no agent session used: the settings change it in place.
   * - An account that an agent session used, or that a first start uses now (it has no agent
   *   session row before its process is ready): it keeps its settings, because a resume reads them.
   *   The settings make the current account instead. An account of the profile that already has
   *   these settings becomes the current one. Otherwise a new account is made. The old account stays.
   */
  saveProvider(profileId: string, kind: string, settings: unknown, ids: Ids, createdAt: string): void {
    const checked = parseSettings(kind, settings)
    const json = canonical(checked)
    this.transaction(() => {
      const current = this.database
        .prepare('SELECT id, settings FROM providers WHERE profile_id = ? AND kind = ? AND is_current = 1')
        .get(profileId, kind)
      if (!current) {
        if (Object.keys(checked).length > 0) this.insertCurrent(profileId, kind, json, ids.next(), createdAt)
        return
      }
      if (canonical(parseSettings(kind, JSON.parse(String(current.settings)))) === json) return
      const used =
        this.starting.has(String(current.id)) ||
        this.database.prepare('SELECT 1 FROM agent_sessions WHERE provider_id = ?').get(String(current.id)) !== undefined
      if (!used) {
        this.database.prepare('UPDATE providers SET settings = ? WHERE id = ?').run(json, String(current.id))
        return
      }
      const same = this.database
        .prepare('SELECT id, settings FROM providers WHERE profile_id = ? AND kind = ? ORDER BY created_at, rowid')
        .all(profileId, kind)
        .find((row) => canonical(parseSettings(kind, JSON.parse(String(row.settings)))) === json)
      // Clear the old mark first: at most one account of a kind is current.
      this.database.prepare('UPDATE providers SET is_current = 0 WHERE id = ?').run(String(current.id))
      if (same) this.database.prepare('UPDATE providers SET is_current = 1 WHERE id = ?').run(String(same.id))
      else this.insertCurrent(profileId, kind, json, ids.next(), createdAt)
    })
  }

  private insertCurrent(profileId: string, kind: string, settingsJson: string, id: string, createdAt: string): void {
    this.database
      .prepare('INSERT INTO providers (id, profile_id, kind, label, settings, is_current, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)')
      .run(id, profileId, kind, DEFAULT_LABEL, settingsJson, createdAt)
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
