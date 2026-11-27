-- Aether database, version 1: profiles, their providers, and the sessions that they own.
-- Decision 0003 (SQLite) and decision 0013 (profiles and providers). Never change this file.
-- A later change is a new file with the next number.
--
-- This file keeps only checks that a later change cannot need to loosen: the type, NOT NULL, the
-- mode, JSON and foreign keys. Aether checks the rest of each value (for example a blank name)
-- before it saves. A change of a CHECK of SQLite needs a rebuild of the table.

-- One row for each profile: one usage, with its own workspace directory and GitHub account.
CREATE TABLE profiles (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  -- The folder that holds the repositories of the profile. NULL until the user chooses it.
  -- A profile of the import has none yet.
  workspace_directory TEXT,
  -- The GitHub account. Its login chooses GH_TOKEN. Aether stores no token.
  -- The name and the avatar (a data URL) are for display.
  github_login        TEXT,
  github_name         TEXT,
  github_avatar       TEXT,
  created_at          TEXT NOT NULL
) STRICT;

-- One row for each provider of a profile, one for each kind. Aether stores no key and no token.
CREATE TABLE providers (
  id         TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  -- The kind of provider, for example claude-code. Each kind has its own settings. No CHECK lists the
  -- kinds, so that a new kind needs no rebuild of the table. Aether refuses an unknown kind.
  kind       TEXT NOT NULL,
  -- A JSON object. Aether validates it for the kind before it saves.
  -- The kind claude-code has the Claude configuration folder (CLAUDE_CONFIG_DIR)
  -- and the Claude profile name (ANTHROPIC_PROFILE).
  settings   TEXT NOT NULL CHECK (json_valid(settings) AND json_type(settings) = 'object'),
  created_at TEXT NOT NULL,
  UNIQUE (profile_id, kind)
) STRICT;

-- One row for each session. A profile owns its sessions: removing the profile removes them.
-- In this version each session is a draft that the import created. Later versions add the rest.
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,
  profile_id  TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  -- The provider of the session. NULL until the first start. The session then keeps it.
  provider_id TEXT REFERENCES providers (id),
  title       TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  -- The five modes of the agent port. The import maps the old settings to one of them.
  mode        TEXT NOT NULL CHECK (mode IN ('ask', 'accept-edits', 'plan', 'auto', 'approve-all')),
  -- The repository or folder that the session started from. The sidebar groups sessions by it.
  source_path TEXT NOT NULL,
  model       TEXT NOT NULL,
  -- A JSON array of { kind, ref, label }.
  attachments TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(attachments) AND json_type(attachments) = 'array'),
  created_at  TEXT NOT NULL
) STRICT;

CREATE INDEX sessions_by_profile ON sessions (profile_id, created_at);

-- Small facts of the app, as key and value: the current profile, and the end of the import.
CREATE TABLE app_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
