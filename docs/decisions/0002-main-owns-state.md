# 0002 The main process owns all state

Date: 2026-11-25
Decided by: the user, on a proposal of the architecture session (step 0).
Status: accepted

## Context

Today the renderer owns the workspace and sends the whole document to the main process on each change. Each streamed chunk sends the whole conversation to the renderer.

## Decision

- The main process owns all state. The renderer keeps only view state.
- Each slice has a contract with a zod schema. A registry lists all contracts.
- The preload exposes only `invoke` and `subscribe`, for names in the registry.
- The main process checks the sender frame and validates each input.
- Events carry only the change and a revision number. A gap loads a new snapshot.
- The renderer never sends a working directory. The main process reads it from the session.

## Rejected

- One preload function per slice. Each slice would edit the preload, and stories would conflict.
- A list of approved directories against a compromised renderer. Such a renderer could still answer a permission question.
