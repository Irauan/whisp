-- Aether database, version 1: workspaces and the sessions that they own.
-- Decision 0003 (SQLite) and decision 0004 (workspaces). Never change this file.
-- A later change is a new file with the next number.

-- One row for each workspace: one usage, with its own root.
CREATE TABLE workspaces (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL CHECK (length(trim(name)) > 0),
  -- NULL until the user chooses the root. A workspace of the import has no root yet.
  root           TEXT CHECK (root IS NULL OR length(trim(root)) > 0),
  -- The GitHub account. Aether stores no token. The name and the avatar (a data URL) are for display.
  github_login   TEXT CHECK (github_login IS NULL OR length(github_login) > 0),
  github_name    TEXT,
  github_avatar  TEXT,
  -- The Claude sign-in: a configuration folder (CLAUDE_CONFIG_DIR) and a profile (ANTHROPIC_PROFILE).
  -- Aether stores no key and no token.
  claude_folder  TEXT CHECK (claude_folder IS NULL OR length(trim(claude_folder)) > 0),
  claude_profile TEXT CHECK (claude_profile IS NULL OR length(trim(claude_profile)) > 0),
  created_at     TEXT NOT NULL,
  CHECK (github_login IS NOT NULL OR (github_name IS NULL AND github_avatar IS NULL))
) STRICT;

-- One row for each session. A workspace owns its sessions: removing the workspace removes them.
-- In this version each session is a draft that the import created. Later versions add the rest.
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  prompt       TEXT NOT NULL,
  -- The five modes of the agent port. The import maps the old settings to one of them.
  mode         TEXT NOT NULL CHECK (mode IN ('ask', 'accept-edits', 'plan', 'auto', 'approve-all')),
  folder       TEXT NOT NULL,
  model        TEXT NOT NULL,
  -- A JSON array of { kind, ref, label }.
  attachments  TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(attachments) AND json_type(attachments) = 'array'),
  created_at   TEXT NOT NULL
) STRICT;

CREATE INDEX sessions_by_workspace ON sessions (workspace_id, created_at);

-- Small facts of the app, as key and value: the current workspace, and the end of the import.
CREATE TABLE app_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
