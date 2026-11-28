-- Aether database, version 6: the folders of the sidebar, and the unread mark of a session.
-- Story S11. A folder exists even when it holds no session, so the sidebar can show an empty group.
-- A session joins its folder by the profile and the path (`sessions.source_path`), with no foreign key:
-- a link by key would need a rebuild of `sessions`.
CREATE TABLE folders (
  id         TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  -- An absolute path, as `sessions.source_path`.
  path       TEXT NOT NULL,
  -- 1 = the group of the sidebar is collapsed.
  collapsed  INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (profile_id, path)
) STRICT;

-- One folder for each distinct profile and source path of the sessions. The time is the oldest session.
INSERT INTO folders (id, profile_id, path, created_at)
  SELECT lower(hex(randomblob(16))), profile_id, source_path, min(created_at)
    FROM sessions
   GROUP BY profile_id, source_path;

-- 1 = the unread mark: a turn ended while the user was elsewhere. It survives a restart.
ALTER TABLE sessions ADD COLUMN unread INTEGER NOT NULL DEFAULT 0 CHECK (unread IN (0, 1));
