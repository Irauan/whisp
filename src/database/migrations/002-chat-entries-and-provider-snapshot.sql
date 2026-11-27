-- Aether database, version 2: the chat of a session.
-- Decision 0003 (SQLite) and decision 0013 (a session keeps the provider settings of its first
-- start). Never change this file. A later change is a new file with the next number.
--
-- Like version 1, this file has no CHECK that lists values that can grow, for example the kinds of
-- entry. Aether validates the JSON of each entry with a zod schema, on every write and every read.

-- The provider settings of the first start of the session, as JSON. NULL until the session has an
-- agent session. A resume uses this value, not the current row of the provider: Claude keeps the
-- history of a session in its configuration folder, so the session must start again with the folder
-- that it started with.
ALTER TABLE sessions ADD COLUMN provider_snapshot TEXT
  CHECK (provider_snapshot IS NULL OR (json_valid(provider_snapshot) AND json_type(provider_snapshot) = 'object'));

-- The ID that the agent gave to the session. A new process resumes the conversation with it.
-- NULL until the first start. It is not a key of Aether: the agent owns it.
ALTER TABLE sessions ADD COLUMN agent_session_id TEXT;

-- One row for each entry of a conversation: user text, agent text, thought, tool call, plan or notice.
-- The position orders the entries of a session. Streamed text is joined before it is saved, so one
-- reply is one row.
CREATE TABLE entries (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  -- The kind of the entry. It repeats the key `kind` of the JSON, for queries.
  kind       TEXT NOT NULL,
  -- A JSON object that Aether validates.
  data       TEXT NOT NULL CHECK (json_valid(data) AND json_type(data) = 'object'),
  created_at TEXT NOT NULL,
  UNIQUE (session_id, position)
) STRICT;
