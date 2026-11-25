# 0003 SQLite for saved data

Date: 2026-11-25
Decided by: the user, on a proposal of the architecture session (step 0).
Status: accepted

## Context

Today Aether saves one JSON file for the workspace and one file per conversation. The conversation files have no version. An unreadable file loads as empty, and the next save overwrites it.

## Decision

- Save all data in one SQLite database through `node:sqlite`.
- Change it with ordered SQL migrations. Record the version in `user_version`.
- Copy the database before a migration. Restore the copy when the migration fails.
- Refuse a newer database. Keep an unreadable database aside.
- Save each conversation entry as one row with validated JSON.

## Trade-offs

- For: transactions, foreign keys, ordered migrations, and appends instead of full rewrites. Synchronous calls prevent overlapping saves.
- Against: a person cannot read the file in an editor. The API is a release candidate. Tests need Node 24.15 or later.

## Rejected

- One versioned JSON file per conversation.
- JSON Lines files.
