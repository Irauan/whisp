# Milestone m1-chat: design and plan

Status: approved by the user on 2026-11-25.

Brief: `brief.md` in this folder.

## Precondition

Milestone 0 is merged. It gives CI, the gates, the simulated agent, the test lock, and path step 2 (contracts, registry, preload).

## Architecture change

The baseline in `docs/architecture.md` stays. This milestone adds these items.

- The agent port takes one neutral start input: main directory, additional directories, model, mode, shared items (empty now), and environment.
- The mode is one of `ask`, `accept-edits`, `plan`, `auto`, `approve-all`. `providers/claude-code` translates it to `default`, `acceptEdits`, `plan`, `auto`, `bypassPermissions`.
- `providers/claude-code` maps the start input to ACP: `session/new` with `additionalDirectories`, the `model` configuration option, and `session/set_mode` before the first prompt.
- If the agent rejects the model or the mode, the session does not start. Aether shows the reason.
- A plan entry keeps the three step states: `pending`, `in_progress`, `completed`. Aether ignores the priority.
- The session window has a plan widget. It reads the latest plan entry of the session.
- The simulated agent gets these scenarios if Milestone 0 does not have them: plan updates, two parallel permission requests, auth required, crash during a turn, and a report of its start input and environment.

Decision 0012 records the one Mode control and the mapping of session settings. The builder writes it in the story S3 PR, from the brief. S2 stores the mode with the five values.

## Stories

The order follows the dependencies. S1 to S4 form the walking skeleton. After S4, the coordinator sends a demo and continues.

| Story | Path step | Behavior a person can see | Defects fixed | Checks | Depends on |
|---|---|---|---|---|---|
| S1 Remove projects and work items | 4 | Projects and work items show "coming soon". | — | A19 | M0 |
| S2 Workspaces in SQLite | 3 | First start imports accounts as workspaces and asks for each root. Workspace settings edit root, GitHub account, Claude folder and profile. | Unreadable conversation file loads as empty | A17, A18 | S1 |
| S3 Session slices | 5 | Create, list, open and delete sessions from the database. Draft sessions open with their prompt and their imported mode. One Mode control with five values replaces Mode and Tool permissions. Worktree and the session attachment show "coming soon". | New session copies "Approve all" | A13, A14 | S2 |
| S4 Chat in a session | 6 | The session window streams replies. Send, stop, restart and resume work. Missing sign-in and crash show clear notices. | Shared process before ready; no permission mode; whole environment | A1, A2, A3, A6, A7, A8, A16, A20 | S3 |
| S5 Permission queue | 6 | Parallel requests show as a queue. Each answer reaches its own request. Stop cancels all. | Second request cancels the first | A4, A5 | S4 |
| S6 Repository and directory trust | 6 | The trust question and the directory questions show before any process starts. | Hooks and MCP servers run without a question | A9, A10 | S4 |
| S7 Session settings reach the agent | — | Model, mode and attachments reach the agent. A model that cannot use Auto shows the notice. | — | A12, A15 | S4 |
| S8 Plan widget | — | The plan shows as a todo list above the composer, with three states. | — | A11 | S4 |
| S9 Idle release and process limit | 6 | Idle processes close after the release time. At most 6 idle processes stay open. | — | A21, A22 | S4 |

S5 to S9 are independent after S4. They can run in parallel worktrees. S5, S6 and S9 touch the agent process code, so the coordinator merges them one at a time.

## Check coverage

| Check | Story |
|---|---|
| A1, A2, A3, A6, A7, A8, A16, A20 | S4 |
| A4, A5 | S5 |
| A9, A10 | S6 |
| A11 | S8 |
| A12, A15 | S7 |
| A13, A14 | S3 |
| A17, A18 | S2 |
| A19 | S1 |
| A21, A22 | S9 |

## Live checks (step 7)

The validator runs A1, A2, A3, A4, A6, A8 and A12 with real Claude. These checks wait for decision 0011. All stories and CI checks can proceed without it.

## Todo list

- [x] User approves the brief and this plan.
- [x] User accepts that the live checks wait for decision 0011.
- [ ] Milestone 0 is merged.
- [ ] Coordinator reads the files and lists what it cannot answer. User answers.
- [ ] Coordinator creates `milestone/m1-chat`.
- [ ] S1 Remove projects and work items
- [ ] S2 Workspaces in SQLite
- [ ] S3 Session slices, with decision 0012
- [ ] S4 Chat in a session
- [ ] Demo of the walking skeleton to the user
- [ ] S5 Permission queue
- [ ] S6 Repository and directory trust
- [ ] S7 Session settings reach the agent
- [ ] S8 Plan widget
- [ ] S9 Idle release and process limit
- [ ] Step 7: milestone validation, with the live checks
- [ ] Step 8: user acceptance
- [ ] Step 9: retrospective
