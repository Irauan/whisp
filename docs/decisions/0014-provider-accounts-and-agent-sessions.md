# 0014 Provider accounts and agent sessions

Date: 2026-11-27
Decided by: the user, during story S4 of milestone m1-chat. The builder of S4 wrote the record. The section "Readings in story S4" lists the points that the user did not decide.
Status: accepted

## Context

Decision 0013 gave a profile one provider row for each kind, and saved a snapshot of the provider settings in the session at its first start. The user changed the model before the first release of the database. A person can have two Claude accounts in one profile. Claude keeps the history of an agent session in its configuration folder, so a resume must use the account that started the agent session.

## Decision

1. A provider row is one account. A profile can have many providers, also of the same kind, for example two Claude accounts. A session belongs to its profile. An agent run belongs to its provider.
2. There is no provider snapshot. Migration `002` has no `provider_snapshot` and no `agent_session_id` in `sessions`.
3. The table `agent_sessions` has one row for each agent run: `id`, `session_id` (cascade), `provider_id`, `external_id` and `created_at`. `external_id` is the ID that the agent gave to its session. A resume uses the provider of the row. Milestone m1-chat creates one row for each Aether session. A later milestone can change the provider inside a session. This milestone does not build that.
4. Migration `002` rebuilds `providers`. It drops `UNIQUE (profile_id, kind)` and adds a `label` and `is_current`. It runs with foreign keys off and ends with `foreign_key_check`. A test migrates a version 1 database and checks that no row is lost.
5. Aether locks the Claude configuration folder of an account once an `agent_sessions` row uses it. A trigger enforces it. The label stays editable.
6. The UI keeps one Claude account for each profile in m1-chat. "Profile settings" edits the current Claude account of the profile.
   - When no agent run used the account, the edit changes the row in place.
   - When an agent run used it, the edit creates a new row and makes it current for new sessions. The old row stays for its agent runs.
7. `sessions.provider_id` (from `001`) is null until the first start. A session without an agent run takes the current account of its profile at its first start, as decision 0013 item 4 said. The first start saves that account in `sessions.provider_id` and in `agent_sessions.provider_id`. User decision, 2026-11-27: an earlier text said "at create". That was an error of the brief.
8. The transcript stays in the SQLite table `entries`, as decision 0003 says.

## Readings in story S4

The user did not decide these points. The builder recorded them, with their source.

- "Current" is the column `providers.is_current`, with a unique index on `(profile_id, kind)` where `is_current = 1`. A switch clears the old row first, then sets the new one, in one transaction. Source: the advisor. Reason: the index is per kind, it needs no circular key, and a later milestone can let the user pick any account.
- The trigger locks only the configuration folder, as the user decided. The edit rule is stricter: a change of the Claude profile name or cleared settings on a used account also makes a new current account, because a resume reads the account row. Source: the advisor. The user can decide if the lock must also cover the Claude profile name.
- When an account of the profile already has the new settings, the edit makes it current. It makes no duplicate. Source: the advisor.
- `sessions.create` leaves `provider_id` null. The first start reads the current account of the profile at that moment. A retry after a failed first start therefore uses the account that the user fixed in the meantime. Source: the user (2026-11-27).
- An account that a first start uses counts as used, from the moment that Aether chooses it until the start ends, because no `agent_sessions` row names it before its process is ready. An edit of the account in that time makes a new current account, so the account that an agent run names always holds the settings that its process started with. The set of these accounts lives in memory, and the slice that starts the agent and the slice that edits accounts share it through the composition root. Source: the coordinator (review of round 2). No format change.
- The first start creates an empty account when the profile has none, as decision 0013 said. A failed first start keeps this account and saves no agent run. Source: the coordinator.
- Aether saves the `agent_sessions` row, and the account of a session that had none, in one transaction, when the agent session exists. The account is the one that the process started with.
- A resume that fails starts a new agent session. Aether updates `external_id` in the same row.
- No `UNIQUE (session_id)` and no cascade on `provider_id`. An account that a run used cannot be deleted. A removed profile still removes its accounts, because its sessions and their runs go in the same statement.

## Replaces in 0013

- Item 3, "one row for each kind and profile: `UNIQUE (profile_id, kind)`".
- The section "A later change of the provider settings", and its snapshot column. A change of the account of a profile applies to new sessions only, as before. The way is a new account, not a snapshot.

The other points of 0013 stay: the words Profile and Workspace directory, the zod check of the settings of each kind, no key and no token, the GitHub account on the profile, and the creation of an empty account at the first start when the profile has none.

## Rejected

- A snapshot of the provider settings in the session. A change of the settings of an account would still need a rule, and the history of Claude lives in the account folder.
- Keep `UNIQUE (profile_id, kind)`. A profile could not hold two Claude accounts.
- Store "current" as the newest row by creation time. A later milestone could not let the user pick an older account.
