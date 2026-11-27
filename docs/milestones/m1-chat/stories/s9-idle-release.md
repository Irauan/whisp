# S9 Idle release and process limit: story spec

Status: draft for the design review. Not approved.

- Milestone: m1-chat. Path step 6.
- Checks: A21, A22.
- Decision: 0006 (one agent process per active session).
- Mockup: none. S9 changes no screen. See "Screens".
- Depends on: S4 (merged), and S6 for the migration number. See "Files and dependencies".

## Behavior

### Terms of the rule

- A session is **idle** when its process is ready, and it has no turn, no open permission request and no background task.
- The **idle time** of a session starts when it becomes idle: at the end of a turn.
- The **release time** is 30 minutes for a session that a person started, and 2 minutes for a session that an automation started.
- The **idle limit** is 6 idle processes.

### Rules

1. An idle process closes when its idle time reaches the release time.
2. When more than 6 processes are idle, the oldest idle process closes first, until 6 stay. The oldest is the one with the earliest idle time. A tie goes to the lower session ID.
3. A session that is not idle never closes for rule 1 or rule 2. This includes a session in the state Starting and a session with an open permission request.
4. The next message after a release resumes the agent session, as after a restart (S4).
5. A pure function with a clock decides the release. It gets the idle sessions, the time now and the limits. It returns the sessions to close.
6. The release checks again that the session is idle right before the close. A message that came in the meantime keeps the process.
7. A message that comes while its process closes waits for the close to end. Then a new process starts and resumes. Two processes never run for one session.
8. The close follows the shutdown of `docs/architecture.md`: cancel, close the session, close stdin, then kill the whole process tree after a limit.
9. A child process of the agent never outlives the release. See open choice 6.

### When the rule runs

- At each turn end, for rule 2. A seventh idle process then closes the oldest one at once.
- On a timer in the composition root, for rule 1. The timer calls the release handler every 30 seconds. The handler reads the time from the `Clock` port.
- A test calls the handler directly with a fake clock. See open choice 4.

### States

The user sees no new state. After a release:

- The session shows Idle, as before.
- The next message shows "Starting Claude Code", as at the first message of a restarted Aether.
- If the resume fails, the S4 notice shows: "Aether could not continue the earlier conversation, so a new one starts."

### Checks

| ID | Check | Level |
|---|---|---|
| A21 | A person's session is idle for 30 minutes, measured with a test clock. Its process closes. The next message resumes the session. | Slice, with a fake clock and the simulated agent over real ACP. See open choice 4. |
| A22 | 7 idle sessions with open processes. The oldest idle process closes. An active session never closes for this limit. | Acceptance. It needs no clock: the seventh turn end triggers the rule. |
| S9-1 | An automated session closes after 2 minutes, a person's session does not. | Unit, pure function |
| S9-2 | A session with an open permission request, or with a turn, never closes. | Unit, pure function |
| S9-3 | A message during the close waits, then resumes in one new process. | Slice |
| S9-4 | After a release, no process of the agent tree runs. The simulated agent starts a child that outlives its parent. | Slice or acceptance. See open choice 6. |

S9-1 to S9-4 are not in the brief. S9-4 adds the scenario "a child process that outlives its parent" that `docs/architecture.md` lists.

## Screens

No screen changes. No mockup.

- The release is silent. The transcript gets no entry.
- Reason: the next message already shows "Starting Claude Code". A notice for each release would add a line to the saved transcript each 30 minutes of idle time.
- If the design review wants a notice, use an info notice that is not saved: "Aether closed the idle agent to save memory. The next message continues the session." This needs a new change type, so it is a separate choice.

## Data

### Migration `004-session-started-by.sql`

```sql
-- Aether database, version 4: who started each session.
-- Decision 0006: the release time depends on who started the session.
ALTER TABLE sessions ADD COLUMN started_by TEXT NOT NULL DEFAULT 'person';
```

- Values: `person` and `automation`.
- No CHECK lists the values. zod validates them on every write and read (user preference 5: rules in code, no table rebuild).
- Each existing session becomes `person`.
- `sessions.create` writes `person`. The renderer cannot set the value. No code in m1 writes `automation`. A later automation feature writes it.
- The number 004 follows `003-directory-trust.sql` of S6. See "Dependencies".
- See open choice 1.

### Memory only

- The idle time of each session lives in `Processes` (main memory). It does not survive a restart. A restart closes every process anyway.
- The release times and the idle limit are constants in one module. See open choice 2.

## Interfaces

- No new contract and no IPC name. The renderer cannot trigger a release.
- New pure function in the sessions domain, for example `src/features/sessions/idle-release.ts`:

```ts
interface IdleSession { id: string; idleSince: Date; startedBy: 'person' | 'automation' }
interface ReleaseLimits { releaseMs: { person: number; automation: number }; idleLimit: number }
function sessionsToRelease(idle: readonly IdleSession[], now: Date, limits: ReleaseLimits): string[]
```

- New handler without a contract, like `record-agent-update`: `src/features/sessions/release-idle/release-idle.handler.ts`. It reads the idle sessions from `Processes`, calls the pure function, and closes the processes.
- `Processes` (`processes.store.ts`) gets:
  - the idle time of each process
  - a closing promise for each session, so that a new start waits for the close
- `send-message.handler.ts` marks the idle time at the turn end, and waits for a closing process before a start.
- The agent port does not change. `close()` keeps its contract. See open choice 6 for its inner change.
- The simulated agent gets a step that starts a child process. The child stays alive until a kill. The step reports the PID of the child to the test control.

## Terms

| Thing | UI | Code | Database |
|---|---|---|---|
| Who started a session | none in m1 | `startedBy`: `person`, `automation` | `sessions.started_by` |
| The close of an idle process | none | release | none |
| The wait before a release | none | release time | none |
| The most idle processes | none | idle limit | none |
| Since when a session is idle | none | idle time, `idleSince` | none |

The terms "person" and "automation" come from decision 0006 and `docs/architecture.md`. The user owns the domain terms (user preference 8).

## Error and empty states

| Case | Behavior |
|---|---|
| No process is open | The handler does nothing. |
| `close()` takes too long | `close()` kills the tree after its limit. It never rejects. |
| The process ends by itself while idle | S4 drops it from `Processes`. The handler finds nothing to close. |
| A message comes during the close | It waits for the close, then starts a new process and resumes. |
| The resume after a release fails | The S4 notice "Aether could not continue the earlier conversation, so a new one starts." shows. |
| The user deletes the session while idle | The delete closes the process, as in S4. |
| Aether quits | `releaseAll` closes every process, as in S4. |
| The clock goes back | An idle time in the future counts as zero. The process stays. |

## Files and dependencies

### Files

- `src/database/migrations/004-session-started-by.sql`: new.
- `src/building-blocks/migrations.test.ts`: the list of migrations. Shared with S6.
- `src/features/sessions/session.ts`, `session.store.ts`: `startedBy`.
- `src/features/sessions/create/create.handler.ts`: writes `person`.
- New `src/features/sessions/idle-release.ts` and its test.
- New `src/features/sessions/release-idle/release-idle.handler.ts` and its test.
- `src/features/sessions/processes.store.ts`: the idle time and the closing promise. Shared with S5.
- `src/features/sessions/send-message/send-message.handler.ts`: the idle time at the turn end, and the wait for a close. Shared with S5, S6 and S7.
- `src/providers/acp/acp-agents.ts`: the kill of the children that outlive the agent. Shared with S5, S6 and S7.
- `src/app/main/composition.ts`: the timer and the limits. Shared with S5, S6 and S7.
- `tests/simulated-agent/agent.mjs`, `scenarios.mjs`, `control.ts`: the child process step. Shared with S5 and S7.
- `docs/architecture.md`: the accepted gaps of open choices 3 and 6, if the user accepts them.

### Dependencies

- Needs: S4 (merged).
- Needs: S6 merged first, because migration 004 follows S6's migration 003. The plan says S9 needs S4 only. The coordinator must update the plan, or S9 takes the next free number when it merges.
- S5, S6 and S9 touch the agent process code. The coordinator merges them one at a time.
- S9 does not need S5 code. Today a permission request only exists during a turn, so "no turn" also means "no open request".

## Open choices

The advisor answered each choice. Its answer is recorded under the choice.

### 1. Save who started a session now

- User column: yes (saved data format).
- Hard to revert: yes. Its undo needs a migration of saved user data.
- Options:
  - A. Migration 004 adds `sessions.started_by`, default `person`, validated in zod. Impact: the architecture rule "Each session records who started it" holds now; S9 waits for S6 for the number.
  - B. No column in m1. The pure function takes the value, and every session counts as `person`. Impact: no saved format and no wait for S6; the column comes with the automation feature, with no table rebuild.
- Recommendation: A.
- Advisor: A. The architecture already requires the record, so the user likely agrees. The term goes to the user.

### 2. The release times as a setting

- User column: yes. Decision 0006 says "Both are settings". This choice narrows an approved decision.
- Hard to revert: no.
- Options:
  - A. Constants in one module, passed in by the composition root. No saved setting, no UI. Impact: the smallest scope; a change of the times needs a new build.
  - B. A saved setting in `app_state`, with no UI. Impact: a new saved key; nobody can change it without a UI.
  - C. A saved setting with a UI. Impact: a new screen and a mockup; more scope in m1.
- Recommendation: A, and a later story adds the UI.
- Advisor: A. User preference 4 (keep the scope small) predicts agreement. It is a hot item, because it narrows decision 0006.

### 3. The background task in the idle rule

- User column: yes (a change of an approved decision).
- Hard to revert: no.
- Facts:
  - Decision 0006 says: idle means no turn, no open permission request and no background task.
  - The Claude adapter tracks background shells and background subagents inside its process. ACP version 1 sends no signal of them to Aether.
  - So after a release, a background command of the agent, for example a dev server, ends with the process.
- Options:
  - A. Count no background task in m1. Record an accepted gap against decision 0006. Impact: a background command ends after the release time; no new protocol work.
  - B. Never release a session that ran a background command in its last turn. Impact: Aether must read the tool calls for a Claude-specific marker; such a process stays open until Aether quits.
  - C. Wait for ACP version 2, which has an idle state update. Impact: S9 cannot close its checks in m1.
- Recommendation: A.
- Advisor: record an accepted gap if the adapter gives no signal. The adapter gives none over ACP version 1. It is a hot item.

### 4. The test level of A21

- User column: yes, if the user sees it as a weaker gate.
- Hard to revert: no.
- Facts: the built app has no test hook (`docs/architecture.md`, Tests). The tests never sleep. A 30-minute wait cannot run in CI.
- Options:
  - A. A slice test: the release handler, a fake `Clock`, an explicit call of the handler, real SQLite and the simulated agent over real ACP. Impact: the brief "with the simulated agent in CI" holds; the acceptance layer does not cover A21.
  - B. A test hook in the built app that moves the clock of the main process. Impact: A21 runs on the built app; the product gets a test hook, against the architecture.
- Recommendation: A. A22 stays an acceptance test, because it needs no clock.
- Advisor: A. Tell the coordinator.

### 5. The idle time and the oldest idle process

- User column: no.
- Hard to revert: no.
- Options:
  - A. The idle time starts at the turn end. The oldest idle process has the earliest idle time. Impact: a session that the user only reads, with no message, can close.
  - B. The idle time also restarts when the user opens the session window. Impact: a new event from the renderer to main; more scope.
- Recommendation: A.
- Advisor: A. The user likely agrees.

### 6. A child process that outlives the agent

- User column: yes (scope and security).
- Hard to revert: no.
- Facts:
  - `shutdown()` in `acp-agents.ts` kills the process tree only when the agent does not end within its limit.
  - An agent that ends cleanly after stdin closes leaves its children alive. On Windows, `taskkill /T` cannot find the children of a process that already ended.
  - Each child has the environment of the agent, with `GH_TOKEN`.
  - No story builds the scenario of `docs/architecture.md`: "a child process that outlives its parent".
- Options:
  - A. S9 adds the scenario, the check S9-4 and the fix. The fix lists the process tree before stdin closes. After the agent ends or the limit passes, it kills each listed process that still runs. It checks the start time of each process, so a reused PID is safe. Impact: no orphan holds `GH_TOKEN`; about one extra system call for each close.
  - B. A separate story for the scenario and the fix. Impact: S9 stays small; the gap stays open until that story.
  - C. Accept the gap. Impact: orphans can run with `GH_TOKEN` after a release or a quit.
- Recommendation: A. A crash of the agent still leaves its children. Record this as a gap.
- Advisor: A. User preference 3 (close a security gap). It is a hot item, because it adds scope.

### 7. A notice at a release

- User column: no.
- Hard to revert: no.
- Options:
  - A. No notice. Impact: no change of the screen or of the saved transcript.
  - B. A notice that is not saved. Impact: a new change type and a mockup.
- Recommendation: A.
- Advisor: A. No mockup, with the reason in "Screens".
