# 0004 Workspaces own sessions

Date: 2026-11-25
Decided by: the user, on a proposal of the architecture session (step 0).
Status: accepted

## Context

The user keeps one directory per usage: one for personal work and one per customer. Each usage has its own GitHub account and its own Claude account. A directory holds many repositories.

## Decision

- A workspace has a name, a root directory, zero or one GitHub account, and zero or one Claude sign-in.
- A workspace owns its sessions. Two workspaces can share a GitHub account.
- A Claude sign-in is a Claude configuration folder and an optional profile name. Aether stores no key or token.
- Repositories are found on disk under the root. Aether does not save them.
- A session has a main directory and a list of additional directories.
- A session keeps the Claude sign-in that it started with.
- Each current account becomes a workspace at import.

## Open

- A project groups one or more repositories in one workspace. Its meaning (epic, milestone or other) is not decided.

## Rejected

- An account as the owner of sessions. Today an account is only a GitHub profile.
