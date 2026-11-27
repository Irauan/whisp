-- Aether database, version 3: the answers of the trust question and of the directory question.
-- Decision 0007 (permissions and trust) and decision 0013 (profiles). Never change this file.
-- A later change is a new file with the next number.
--
-- Trust belongs to one profile (user decision, 2026-11-27). Trusting a repository in one profile
-- does not trust it in another. Removing a profile removes its answers.
--
-- Each path is the key of a folder, not the text that the user typed. Aether resolves `..`, junctions
-- and symbolic links, and on Windows it also lowers the letter case, before it saves or reads a key.
-- Two spellings of one folder then give one row.

-- The Git repositories, and the plain folders with a hook or an MCP server, that a profile trusts.
-- The path is the root of the repository. Trust covers the whole repository.
CREATE TABLE trusted_repositories (
  profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, path)
) STRICT;

-- The folders outside the workspace directory of a profile, or in the workspace directory of
-- another profile, that the user chose "Always allow for this profile" for. The path is the folder
-- of the session. "Allow once" is not saved: it covers one session, in memory.
CREATE TABLE allowed_directories (
  profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, path)
) STRICT;
