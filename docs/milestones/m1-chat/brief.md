# Milestone m1-chat: brief

Status: approved by the user on 2026-11-25.

## Outcome

The user chats with Claude in an Aether session. The session runs in a profile, in a folder that the user chose.

## Current behavior and gap

- A session is a draft. `SessionPage.tsx` says "Aether cannot run sessions yet."
- The only chat is `AgentPanel.tsx` on a work item. Decision 0005 removes work items.
- `src/main/agents/host.ts` shares one process between sessions, keeps one permission question, sets no permission mode, and passes the whole environment.
- The renderer owns the old workspace data and saves JSON files.
- The session settings (model, mode, permissions, worktree, attachments) reach no agent.
- `applyUpdate` in `src/shared/agent.ts` reduces a plan step to done or not done. The plan shows as a transcript entry only.
- Seven known defects are listed in `docs/architecture.md`. This milestone fixes all seven.

## User experience

### Flows

1. First start after the upgrade. Aether imports each account as a profile. A dialog asks for the workspace directory of each profile.
2. New session. The user chooses a folder, settings and a prompt, then sends. The session window opens and the reply streams.
3. First use of a repository. Aether shows the trust question with the hooks and MCP servers it found. No agent process starts before the answer.
4. Conversation. The user sends more messages. The user stops a turn. The user allows or refuses each tool in the permission queue.
5. Restart. The user quits and starts Aether. The user opens the session, sees the conversation and continues it.
6. Draft session from the import. The session opens with its prompt in the composer. Send starts it.

### Session window

| Part | Content |
|---|---|
| Header | Title, and the button "Delete session". User decision, 2026-11-27: "I don't think we need this header for sessions, at least this part detailing mode, folder, profile, and so on! The session name we can keep it and make it editable (not necessarily in this milestone)." Mode and model show as the controls of the composer. An editable title is a later item. |
| Transcript | User text, agent text, thoughts (folded), tool calls with status, notices |
| Plan widget | The latest plan of the agent, pinned above the composer |
| Permission queue | One card per open request, oldest first, inline in the transcript, where Claude asked. The cards scroll with the chat. User decision, 2026-11-27: "all cards should be part of the chat like Claude code, not queue over the chat input and squeeze the chat window." |
| Composer | Text, Send, and Stop during a turn |

### Plan widget

- It shows the latest plan as a todo list, like the Claude desktop app.
- Each step shows one of three states: pending (empty circle), in progress (spinner), completed (check).
- The header shows the count, for example "Plan 2 of 5".
- The user can fold the widget. It stays after the turn ends.
- A new plan replaces the old one in the widget. The transcript shows "Updated the plan" at that point.
- The plan is saved as an entry, so it shows again after a restart.

### States

| State | What the user sees |
|---|---|
| Starting | "Starting Claude Code" with a spinner. Stop is available. |
| Working | Streamed text and tool calls. Stop is available. |
| Waiting for permission | The permission queue. Stop is available. |
| Idle | The composer is ready. |
| Not signed in | "Claude Code is not signed in." and the sign-in steps of the profile. |
| Agent stopped | An error notice with the exit code and the last log lines. The next message starts a new process. |
| Trust refused | "Aether did not start the agent in this repository." |

### Visual references

- The current design tokens in `src/renderer/src/styles.css`.
- The todo list of the Claude desktop app, for the plan widget.

## Approach

- Follow steps 3 to 6 of "Path from the current code" in `docs/architecture.md`.
- Do step 4 (remove projects and work items) before step 3 (SQLite). The import then has less data to move. Between these two stories, the app has no chat. This is on the milestone branch only.
- The first four stories form the walking skeleton: an end-to-end chat with the simulated agent.
- One Mode control replaces the two controls Mode and Tool permissions. Its five values match the permission modes of Claude. Decision 0012 records it.
- The agent port uses neutral values: `ask`, `accept-edits`, `plan`, `auto`, `approve-all`. The Claude provider translates them.
- A new session copies the mode of the last session. Approve all is never copied. It becomes Ask.
- The import maps the old settings of a draft in this order: Plan to Plan, Autopilot to Auto, Approve all to Approve all, Assisted to Auto, else Ask.
- The settings map to the agent as below.

| Aether setting | Agent input |
|---|---|
| Model | The `model` configuration option. "Default" sends nothing. |
| Mode Ask | Permission mode `default`. Claude asks before each tool. |
| Mode Accept edits | Permission mode `acceptEdits` |
| Mode Plan | Permission mode `plan` |
| Mode Auto | Permission mode `auto`. If the model cannot use it, Claude uses `acceptEdits` and Aether shows the notice. |
| Mode Approve all | Permission mode `bypassPermissions` |
| Worktree | Disabled, "coming soon". The session uses the folder as it is. |
| Attachment: file, folder, repository file or folder | A resource link in the first message |
| Attachment: folder outside the session folder | Also an additional directory, after the directory question |
| Attachment: issue or pull request | The URL as text in the first message |
| Attachment: session | Disabled, "coming soon" |

### Rejected alternatives

- Keep the chat on work items. Decision 0005 removes them.
- Build a worktree now. The Git identity for commits and pushes is an open point. The cleanup rules are not defined.
- Two controls, Mode and Tool permissions. Claude has one permission mode, so two controls could select one effect twice or select a conflict.
- Map Autopilot to `bypassPermissions`. Approve all already does that. The user renamed Autopilot to Auto, to match Claude.
- Show the plan only in the transcript. The user asked for a widget.

## Acceptance checks

Each check runs with the simulated agent in CI. Checks marked "live" also run with real Claude in step 7.

| ID | Given | When | Then |
|---|---|---|---|
| A1 | Profile "Personal" with workspace directory R, repository R/repo-a, trusted | The user creates a session in R/repo-a with "Say hello" | The reply streams into the session window. The entries are saved. (live) |
| A2 | A1 is done | The user sends "Say it again" | The reply comes in the same agent session. (live) |
| A3 | A long reply streams and a tool call is open | The user clicks Stop | "Stopped." shows, the tool call shows failed, and the composer is ready. (live) |
| A4 | The agent asks two permissions at the same time | The user allows the first and refuses the second | Both cards show. The agent receives each answer for its own request. (live) |
| A5 | A4 is repeated, with two open requests | The user clicks Stop | Both cards show as not answered, with the reason "Not answered: you pressed Stop.". The agent receives "cancelled" for both. User decision, 2026-11-27: "if the session had a question that was not answered we should make clear that it was not answered and why it was not answered." |
| A6 | A session with two turns | The user quits and starts Aether, opens the session, and sends a message | The transcript shows both turns. The agent resumes the same session. (live) |
| A7 | Two sessions in two repositories | The user sends in both within 100 ms | Both get replies. Each session has its own process. |
| A8 | The agent answers "auth required" | The user sends a message | "Claude Code is not signed in." and the sign-in steps show. Aether does not crash. (live, with a profile that has no sign-in) |
| A9 | Repository R/repo-b, not trusted, with a `SessionStart` hook and `.mcp.json` | The user sends the first message | The trust question lists the hook and the MCP server. No agent process exists. Cancel leaves no process and the hook does not run. |
| A10 | A session folder outside the workspace directory, or under the workspace directory of another profile | The user sends the first message | The directory question shows, as `docs/architecture.md` describes. |
| A11 | The agent sends a plan with 3 steps, then marks step 1 completed and step 2 in progress | — | The widget shows "Plan 1 of 3" with the three states. After a restart, the widget shows the same plan. |
| A12 | Model Opus 5.5 and mode Ask | The session starts | The agent receives model `claude-opus-5-5` and mode `default`. Accept edits gives `acceptEdits`, Plan gives `plan`, Auto gives `auto`, and Approve all gives `bypassPermissions`. With a model that cannot use Auto, the notice shows. |
| A13 | The settings menu | The user opens it | One Mode control shows the five modes. No Tool permissions control exists. Worktree and the session attachment show "coming soon" and are disabled. |
| A14 | The last session used Approve all, or Auto | The user opens a new session | After Approve all, the mode shows Ask. After Auto, the mode shows Auto. |
| A15 | A file attachment and a folder outside the session folder | The session starts | The first message has a resource link for each. The folder is an additional directory. |
| A16 | Aether runs with `ANTHROPIC_API_KEY=x` and `FOO=y` in its environment | A session starts | The agent environment has neither. It has `GH_TOKEN` of the GitHub account of the profile. |
| A17 | A user data folder with `workspace.json` (2 accounts, 3 session drafts) and `runs/` | The first start after the upgrade | 2 profiles and 3 sessions exist. Each draft has the mode from the import order. The old files are unchanged. |
| A18 | An unreadable `workspace.json`, or an unreadable database | Aether starts | Aether keeps the file aside, shows a message, and never overwrites it. |
| A19 | — | The user opens Projects or Work items | "Coming soon" shows. |
| A20 | The agent process exits during a turn | — | An error notice shows the exit code. The next message starts a new process and resumes. |
| A21 | A person's session is idle for 30 minutes, measured with a test clock | — | Its process closes. The next message resumes the session. |
| A22 | 7 idle sessions with open processes | — | The oldest idle process closes. An active session never closes for this limit. |
| A23 | A started session | The user sends a first message of 10 characters or more | Claude names the session. The title strip and the sidebar show its title. A title that the user set with Rename stays. Added by the user on 2026-11-28 (S10). |
| A24 | A profile with sessions in two folders, and an added empty folder | The user collapses a group, adds a folder, starts a session from a group's '+', and removes the empty folder from its right-click menu | The sidebar shows the folders like the GitHub Copilot app. The collapse and the empty folder survive a restart. Added by the user on 2026-11-28 (S11). |
| A25 | Two sessions, one open | Claude works, answers in the other session, and asks a permission | The icon of the other session fades while it works, turns blue at the answer until it is opened, and shows a yellow hand while a card waits. Added by the user on 2026-11-28 (S11). |

## Non-goals

- Projects, work items and their meaning.
- Worktrees and session attachments.
- The shared library of skills and MCP servers.
- Early start of the process when the user starts to type.
- Git identity and credentials for commits and pushes by the agent.
- Packaging, Electron fuses, a custom protocol, macOS and Linux.
- Voice input. It stays "coming soon".
- Sessions that run on another computer.
- Agents other than Claude Code. The registry still lists them, but no check covers them.

## Constraints

- `docs/process.md` and `docs/architecture.md` bind. Decisions 0001 to 0010 bind.
- Milestone 0 is done first: CI, the gates, the simulated agent, the test lock, and path step 2 (contracts, registry, preload).
- Windows 11 only. Node 24.15 or later for tests.
- Aether stores no key and no token.
- The repository is public. Test data holds no real account data.
- Commits are signed through 1Password.

## Decisions

| Decision | Who | Record |
|---|---|---|
| Slices, state, SQLite, workspaces, removal, processes, permissions, skills, tests, rule tools | The user | `docs/decisions/0001` to `0010` |
| Profiles and providers replace workspaces. Root becomes workspace directory. | The user, 2026-11-26 | `docs/decisions/0013-profiles-and-providers.md` |
| Claude billing: subscription only | The user, 2026-11-27 | `docs/decisions/0011-claude-billing.md` |
| One Mode control with five values, and the mapping of session settings to the agent | The user, 2026-11-25 | `docs/decisions/0012-session-settings.md`, written in story S3 |
| Order of steps 3 and 4 | The user, 2026-11-25 | This brief |
| Milestone 0 before m1-chat, with path step 2 in Milestone 0 | The user, 2026-11-25 | This brief |

## Assumptions and risks

| Item | How the milestone tests it |
|---|---|
| The adapter resumes a session after a restart of Aether. | A6, live. If resume fails, Aether starts a new session and shows a notice. |
| The adapter accepts the model and the permission mode before the first message. | A12 with the simulated agent. Live check in step 7. |
| Some models cannot use `auto`. | A12 checks the fallback notice. |
| Playwright for Electron is experimental. | Milestone 0 proves it. All checks depend on it. |
| `node:sqlite` is a release candidate. | Slice tests with a real database. |
| One process costs about 305 MB. | A22 limits the idle processes. |
| A compromised renderer can answer a permission question. | Accepted in `docs/architecture.md`. No check. |
| Live checks need a usable Claude sign-in. | Decision 0011: the live checks of step 7 use the subscription of the user. |

## Accepted gaps

- Live checks and acceptance wait for decision 0011. Reason: the stories and the CI checks do not need real Claude, so work can start now.
- Between S2 and S3, session drafts are read-only. Reason: S2 stops all writes to the old files, and S3 builds the session slices. User decision, 2026-11-26.

## Budget

55 agent runs.

- 9 stories at about 5 runs each: 45.
- Validator: 2.
- Rework: 8.
