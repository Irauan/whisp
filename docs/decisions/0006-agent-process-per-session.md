# 0006 One agent process per active session

Date: 2026-11-25
Decided by: the user, on a proposal of the architecture session (step 0).
Status: accepted

## Context

Today sessions of one agent share one process. A second session can use it before it is ready and then fails. One process per session costs about 305 MB. A warm start takes 0.7 to 1.0 s.

## Decision

- Each active session has its own agent process.
- An idle process closes after a release time: 30 minutes for a person, 2 minutes for an automation. Both are settings.
- Idle means no active turn, no open permission question and no background task.
- At most 6 idle processes stay open. The oldest idle one closes first.
- Aether can start the process when the user starts to type.
- The next message resumes a released session.
- Only `providers/acp` imports the ACP library. Claude is one launch recipe.

## Trade-offs

- For: no shared start, a crash stops one session, and each workspace has its own Claude environment.
- Against: more memory than a shared process.

## Rejected

- One shared process per agent.
- Immediate close of an idle process. Each next message would wait for a start.
