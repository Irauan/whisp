# 0013 Profiles and providers

Date: 2026-11-26
Decided by: the user, during story S2 of milestone m1-chat.
Status: accepted

## Context

Decision 0004 named the unit of usage a "workspace" and gave it a root directory and one Claude sign-in. The S2 story built it. During the story the user changed the data model before the first release of the database. A workspace needs more than one way to run agents, and a session needs to remember how it started.

## Decision

1. "Workspace" becomes "Profile" everywhere: UI, database, code and documents.
   - The feature folder is `src/features/profiles/`.
   - The contract names are `profiles.*`, including `profiles.list-github-accounts`.
   - The field `ANTHROPIC_PROFILE` of Claude is labeled "Claude profile name".
2. "Root" becomes "Workspace directory": the folder of a profile that holds its repositories. A folder outside it still gets the directory question (check A10).
3. A new table `providers` holds the providers of a profile.
   - A profile owns its rows, one for each provider kind: `UNIQUE (profile_id, kind)`. A removed profile removes its rows.
   - The kind `claude-code` exists now. Its settings are the Claude configuration folder and the Claude profile name, as JSON. Aether validates the JSON with a zod schema for each kind.
   - Aether stores no key and no token.
   - The Claude columns leave the table `profiles`. The settings of a profile edit the Claude provider row.
   - The import creates no provider row, because the old accounts had no Claude settings.
4. A session has these columns: `profile_id`, a nullable `provider_id`, `source_path`, prompt, mode, model, attachments and creation time.
   - Aether sets `provider_id` at the first start of the session. The session keeps it.
   - `source_path` is the repository or folder that the session started from. The sidebar groups sessions by it.
5. The GitHub account stays on the profile. Its login chooses `GH_TOKEN` (check A16).
6. Migration `001` is written for this model. The database was not released, so the file could change. It keeps only the checks of type, NOT NULL, mode, JSON and foreign keys. It has no check of a blank text and no check of the GitHub name or avatar, because a later change of a CHECK needs a rebuild of the table.

## Replaces in 0004

- The name "workspace" and the term "root". Read "profile" and "workspace directory".
- "A workspace has ... zero or one Claude sign-in". A profile has zero or more providers. The Claude sign-in is the settings of the provider `claude-code`.
- "A session keeps the Claude sign-in that it started with". A session keeps its provider.

The other points of 0004 stay: the profile owns its sessions, two profiles can share a GitHub account, the repositories are found on disk, and each current account becomes a profile at import.

## Out of milestone m1-chat

- Worktrees for each session. No column exists for them.
- Projects, in the style of the Copilot apps. No column exists for them.
- Provider kinds other than `claude-code`.

## Rejected

- Keep the Claude columns on the table `profiles`. A second provider kind would need a new column in the table of every profile.
- Store the provider settings in the session. A session would lose the link to the provider that it started with.
