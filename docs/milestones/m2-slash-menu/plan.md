# Milestone m2-slash-menu: design and plan

Status: approved by the user on 2026-11-28.

Brief: `brief.md` in this folder.

## Precondition

- `milestone/m1-chat` passed step 7 (PR #44). S10 and S11 still run there.
- `milestone/m2-slash-menu` starts from the tip of `milestone/m1-chat`. User decision, 2026-11-28.
- The M2 milestone PR to `main` opens only after the user merges M1 to `main`.

## Architecture change

The baseline in `docs/architecture.md` stays. This milestone adds these items.

- The agent port gets one neutral update `commands`: a list of `{ name, description, hint }`. `hint` can be empty.
- `providers/acp` translates `available_commands_update` into it. It drops a command without a name, and it keeps the agent order.
- The main process keeps the latest list of each session in memory. It also keeps the last list for each pair of Claude account and folder, in memory, to fill a menu while an agent starts.
- New query `sessions.list-commands`: the list of an owner (a session ID, or a draft ID of S3) and its state (`loading`, `ready`, `no-agent`). New event `sessions.commands-changed` carries each change. The provider drops `remote-control`.
- The renderer has one slash menu component. `ReplyComposer` and `SessionComposer` both use it. The `/` trigger counts only at the start of the text.
- The agent starts when a session opens. `ensureProcess` keeps the order of S9: wait for a closing process, the S6 guard, then the start.
- The "New session" page owns a draft agent, started on intent, never at launch. It has a draft ID in memory, no session row and no `agent_sessions` row. Send creates the session and adopts the draft agent.
- An early start saves no agent run at `ready`. Aether saves the agent run when the first prompt goes out. So the rules of the first message and of `isDraft` keep working.
- The port gets `AgentProcess.configure(mode, model)`. An early agent starts with the chosen mode (never Approve all) and gets the final mode and model at Send.
- A draft agent counts for the idle limit and the release time of decision 0006. The main process closes it when the user leaves the page, when the renderer reloads, or when its profile, folder or Claude account changes. A start that is not ready is busy for the release.
- `docs/architecture.md`, section "Agents": the line "Aether can start the process when the user opens a session and starts to type" becomes "Aether starts the process when the user opens a session, or on intent on the New session page (decision 0015)".
- New slice `repositories.list-files`: input a session ID or a draft ID, never a path. It refuses a UNC path. A new Git port and `src/providers/git/` run `ls-files`. Git repository: `git ls-files --cached --others --exclude-standard`. Plain folder: a walk that skips `.git` and `node_modules`. Limit 50,000 files. When Git fails, Aether walks the folder. It replaces the IPC handlers `repository:files` and `issues` and their preload entries. The `#` menu goes away (user decision, 2026-11-28).
- Both composers get one editor with inline tokens (S1): a command tag at the start, and file mentions (S4). The `user` entry saves `command` and `mentions` (optional fields).
- The slash menu and the file menu share one menu component. `mention.ts` gets the `/` trigger at the start of the text. `@` works in both composers.
- `sessions.send-message` accepts file and folder attachments of the session folder on any turn. Each gives a resource link with that turn. The `user` entry saves them (an optional field). Decision 0012 gets a note.
- No migration and no new saved format.
- The simulated agent gets these scenarios: a command list after `session/new` and after a resume, a later change of the list, a list that depends on the Claude folder of the profile, and a report of each `session/new`.

## Stories

The order follows the dependencies. S1 is the walking skeleton. After S1, the coordinator sends a demo and continues.

| Story | Behavior a person can see | Checks | Depends on |
|---|---|---|---|
| S1 Slash menu in a running session | After the first message, `/` at the start of the text opens the menu with the commands of the agent. Filter, keys, mouse and scroll work. A pick becomes a tag at the start of the text, in a new editor with inline tokens. The list updates while the menu is open. | B1, B2, B3, B4, B5, B6, B7, B8 | M1 S10 merged into m1-chat and synced (both touch `acp-agents.ts`) |
| S2 Agent starts when a session opens | Opening a session without a process resumes the agent at once, after the trust question. The menu works before the next message. Decision 0015. | B9, B10, B14 | S1 (both change the start code) |
| S3 Draft agent on the "New session" page | The page starts an agent for the draft. The menu works before the first message. Send adopts the agent. A change of folder, profile or account restarts it. Leaving the page closes it. An attachment outside the folder starts a new agent at Send. | B11, B12, B13 | S2 |
| S4 File list for `@` | `@` in both composers lists the files of the session folder with type icons, like the Copilot app. It works in plain folders. A file picked in a reply goes to the agent with that turn. | B15, B16, B17, B18, B19 | S3 (the draft ID names the folder of the page), S1 |

- The stories run one after the other: S1, S2, S3, S4. S1 and S2 change the start code; S2 and S3 share `agent-start.ts`; S4 needs the draft ID of S3. Specs and tests of a later story can start while an earlier one builds.
- M1 S10 and S11 change `acp-agents.ts`, `entry.ts`, `session-view.ts`, `send-message.handler.ts`, `SessionComposer.tsx`, `App.tsx`, `contracts.ts` and `composition.ts`. The coordinator syncs `milestone/m1-chat` before each story builds.
- Story specs and mockups: `stories/` in this folder. Step 2 writes them before the design review.

## Check coverage

| Check | Story |
|---|---|
| B1, B2, B3, B4, B5, B6, B7, B8 | S1 |
| B9, B10, B14 | S2 |
| B11, B12, B13 | S3 |
| B15, B16, B17, B18, B19 | S4 |

## Live checks (step 7)

The validator runs B1, B2, B8, B9, B11 and B17 with real Claude. Decision 0011: these checks use the subscription of the user. The validator also counts the files that the early starts of B12 leave in the Claude folder.

## Open choices

Each spec lists its open choices with a recommendation. Design review run 1 (2026-11-28) checked the specs; the user answered four hot items the same day (see the Decisions table of the brief).

## Todo list

- [x] User approves the brief and this plan (2026-11-28).
- [x] Step 2: specs and mockups for S1, S2, S3 and S4 in `stories/`.
- [x] Step 2: design review run 1 (FAIL, 2026-11-28). Specs revised; the user answered four hot items.
- [x] User approves the design review (2026-11-28).
- [ ] Coordinator reads the files and lists what it cannot answer. User answers.
- [ ] Coordinator creates `milestone/m2-slash-menu` from `milestone/m1-chat`.
- [ ] Sync `milestone/m1-chat` after M1 S10 and S11 merge.
- [ ] S1 Slash menu in a running session.
- [ ] Demo of the walking skeleton to the user, after the S1 merge.
- [ ] S2 Agent starts when a session opens, with decision 0015.
- [ ] S3 Draft agent on the "New session" page.
- [ ] S4 File list for `@`.
- [ ] Sync `milestone/m1-chat` after each later M1 merge.
- [ ] Step 7: milestone validation, with the live checks.
- [ ] User merges M1 to `main`. Then the M2 milestone PR opens.
- [ ] Step 8: user acceptance.
- [ ] Step 9: retrospective.
