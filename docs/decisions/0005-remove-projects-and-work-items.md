# 0005 Remove the code of projects and work items

Date: 2026-11-25
Decided by: the user, on a proposal of the architecture session (step 0).
Status: accepted

## Context

The user accepts that projects and work items show "coming soon". The installed profile has no projects and no work items.

## Decision

- Show "coming soon" for projects and work items.
- Delete their code. Git keeps it.
- Keep the old `workspace.json` and `runs/` on disk, unchanged. Import accounts and sessions once.
- A later removal of a workspace does not change the old files.

## Rejected

- Hidden code. It would still need types, rules and tests.
