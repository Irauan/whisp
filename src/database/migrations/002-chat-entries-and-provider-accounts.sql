-- Aether database, version 2: provider accounts, agent sessions and the chat entries.
-- Decision 0003 (SQLite) and decision 0014 (provider accounts and agent sessions). Never change
-- this file. A later change is a new file with the next number.
--
-- Like version 1, this file has no CHECK that lists values that can grow, for example the kinds of
-- entry or of provider. Aether validates the JSON of each entry and of each provider with a zod
-- schema, on every write and every read.

-- 1. Providers. A row is one account. A profile can have many providers, also of one kind, for
--    example two Claude accounts. The rebuild drops UNIQUE (profile_id, kind), and adds a label and
--    the mark of the current account. Each row of version 1 is the only row of its kind in its
--    profile, so it becomes the current one.
--    The migration runs with foreign keys off. The order matters: create the new table, copy, drop
--    the old table, then rename the new one. Renaming the old table first would make SQLite rewrite
--    the references of `sessions` to the old name.
CREATE TABLE providers_new (
  id         TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  -- The kind of provider, for example claude-code. Each kind has its own settings.
  kind       TEXT NOT NULL,
  -- The name that the user gives the account. It can change at any time.
  label      TEXT NOT NULL DEFAULT '',
  -- A JSON object. Aether validates it for the kind before it saves.
  -- The kind claude-code has the Claude configuration folder (configFolder, CLAUDE_CONFIG_DIR)
  -- and the Claude profile name (profileName, ANTHROPIC_PROFILE).
  settings   TEXT NOT NULL CHECK (json_valid(settings) AND json_type(settings) = 'object'),
  -- 1 for the account that new sessions of the profile use, for each kind. At most one row.
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  created_at TEXT NOT NULL
) STRICT;

INSERT INTO providers_new (id, profile_id, kind, label, settings, is_current, created_at)
  SELECT id, profile_id, kind, '', settings, 1, created_at FROM providers;

DROP TABLE providers;
ALTER TABLE providers_new RENAME TO providers;

CREATE UNIQUE INDEX providers_current ON providers (profile_id, kind) WHERE is_current = 1;
CREATE INDEX providers_by_profile ON providers (profile_id, kind, created_at);

-- 2. Agent sessions: one row for each agent run. A run belongs to a session and uses one provider.
--    A resume uses the provider of its row. A later milestone can add runs with another provider
--    inside one session. The provider key has no cascade: an account that a run used cannot be deleted.
CREATE TABLE agent_sessions (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES providers (id),
  -- The ID that the agent gave to its session. A new process resumes the conversation with it.
  -- It is not a key of Aether: the agent owns it.
  external_id TEXT NOT NULL,
  created_at  TEXT NOT NULL
) STRICT;

CREATE INDEX agent_sessions_by_session ON agent_sessions (session_id, created_at);
CREATE INDEX agent_sessions_by_provider ON agent_sessions (provider_id);

-- 3. Lock the Claude configuration folder of an account that an agent run used. Claude keeps the
--    history of a session in that folder, so a resume needs the same folder. The label and the
--    other settings stay editable here. Aether makes a new account for a change of the folder.
CREATE TRIGGER providers_lock_config_folder
BEFORE UPDATE OF settings ON providers
WHEN json_extract(OLD.settings, '$.configFolder') IS NOT json_extract(NEW.settings, '$.configFolder')
  AND EXISTS (SELECT 1 FROM agent_sessions WHERE provider_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'The Claude folder of an account that an agent session used cannot change.');
END;

-- 4. The entries of a conversation: user text, agent text, thought, tool call, plan or notice.
--    The position orders the entries of a session. Streamed text is joined before it is saved, so
--    one reply is one row.
CREATE TABLE entries (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  -- The kind of the entry. It repeats the key `kind` of the JSON, for queries. The CHECK keeps the two equal, also when the JSON has no key kind.
  kind       TEXT NOT NULL,
  -- A JSON object that Aether validates.
  data       TEXT NOT NULL CHECK (json_valid(data) AND json_type(data) = 'object'),
  created_at TEXT NOT NULL,
  CHECK (kind IS json_extract(data, '$.kind')),
  UNIQUE (session_id, position)
) STRICT;
