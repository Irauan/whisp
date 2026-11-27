import type { Database } from '../../building-blocks/database'

/** A profile, as the trust questions need it. */
export interface ProfileFacts {
  id: string
  name: string
  /** The workspace directory as saved, or null until the user chooses it. */
  workspaceDirectory: string | null
}

/**
 * The answers of the trust and directory questions, and the facts about profiles that decide which
 * question applies. Answers belong to one profile (user decision, 2026-11-27). Each path is the key
 * of a folder (`pathKey`): the caller resolves it before it saves or reads. "Allow once" lives in
 * memory and covers one session.
 */
export class TrustStore {
  private readonly once = new Map<string, Set<string>>()

  constructor(private readonly database: Database) {}

  /** The profile, or null when it does not exist. */
  profile(profileId: string): ProfileFacts | null {
    const row = this.database.prepare('SELECT id, name, workspace_directory FROM profiles WHERE id = ?').get(profileId)
    return row ? toFacts(row) : null
  }

  /** The other profiles, in the order of their creation. */
  otherProfiles(profileId: string): ProfileFacts[] {
    return this.database
      .prepare('SELECT id, name, workspace_directory FROM profiles WHERE id <> ? ORDER BY created_at, rowid')
      .all(profileId)
      .map(toFacts)
  }

  /**
   * The Claude folder of the account that would read the files of the session: the account of its
   * agent run when it has one, else the current account of the profile. Null when no account sets a
   * folder: Claude then uses its default folder. It reads and never creates an account.
   */
  claudeFolderOf(sessionId: string, profileId: string): string | null {
    const run = this.database
      .prepare(
        `SELECT p.settings FROM agent_sessions a JOIN providers p ON p.id = a.provider_id
         WHERE a.session_id = ? ORDER BY a.created_at DESC, a.rowid DESC LIMIT 1`
      )
      .get(sessionId)
    const row =
      run ?? this.database.prepare("SELECT settings FROM providers WHERE profile_id = ? AND kind = 'claude-code' AND is_current = 1").get(profileId)
    if (!row) return null
    const settings: unknown = JSON.parse(String(row.settings))
    const folder = typeof settings === 'object' && settings !== null ? (settings as Record<string, unknown>).configFolder : undefined
    return typeof folder === 'string' && folder !== '' ? folder : null
  }

  isTrusted(profileId: string, key: string): boolean {
    return this.database.prepare('SELECT 1 FROM trusted_repositories WHERE profile_id = ? AND path = ?').get(profileId, key) !== undefined
  }

  trust(profileId: string, key: string, createdAt: string): void {
    this.database
      .prepare('INSERT OR IGNORE INTO trusted_repositories (profile_id, path, created_at) VALUES (?, ?, ?)')
      .run(profileId, key, createdAt)
  }

  /** True after "Always allow for this profile", or after "Allow once" in this session. */
  isAllowed(profileId: string, sessionId: string, key: string): boolean {
    if (this.once.get(sessionId)?.has(key)) return true
    return this.database.prepare('SELECT 1 FROM allowed_directories WHERE profile_id = ? AND path = ?').get(profileId, key) !== undefined
  }

  allowAlways(profileId: string, key: string, createdAt: string): void {
    this.database
      .prepare('INSERT OR IGNORE INTO allowed_directories (profile_id, path, created_at) VALUES (?, ?, ?)')
      .run(profileId, key, createdAt)
  }

  /** "Allow once": the session may use the folder until Aether quits or the session is gone. */
  allowOnce(sessionId: string, key: string): void {
    const keys = this.once.get(sessionId) ?? new Set<string>()
    keys.add(key)
    this.once.set(sessionId, keys)
  }

  /** Forgets "Allow once" of a session that Aether deleted. */
  forgetSession(sessionId: string): void {
    this.once.delete(sessionId)
  }
}

function toFacts(row: Record<string, unknown>): ProfileFacts {
  return {
    id: String(row.id),
    name: String(row.name),
    workspaceDirectory: row.workspace_directory === null || row.workspace_directory === undefined ? null : String(row.workspace_directory)
  }
}
