# S3 Draft agent on the "New session" page: story spec

Status: approved by the user on 2026-11-28 ("Approve"), after design review run 1. The user chose the recommended option (A) of each open choice that the user did not decide by name.

- Milestone: m2-slash-menu.
- Checks: B11, B12, B13.
- Decision: 0015 (S2 writes it). S3 adds the draft rules to it.
- Mockup: none for the page. The menu is the mockup of S1. See "Screens".
- Depends on: S1 (the menu, the commands owner), S2 (`agent-start.ts`, the start record).

## Today

- The start view is `home` (`navigation.ts`). It renders `SessionComposer` (`App.tsx` 121), and its folder is preset to the folder of the last session (`SessionComposer.tsx` 77).
- The page has no session row. Send calls `sessions.create`, then `sessions.send-message`. The first start runs then.
- A draft row (an imported draft, or a session whose first start failed) opens in the session window with `ReplyComposer` and `draft = true`.
- `isDraft` (`entry.ts` 233): no entry, no agent run, status idle.
- The links of the attachments go with the "first" message: no process and no agent run (`send-message.handler.ts` 105). A first start that failed saved no run, so its retry sends the links again (decision 0012, "Readings in story S7").
- The start saves the agent run at `ready` (`startProcess`, 233-234). The trust questions belong to a session ID. The port has no call to change the mode or the model after the start.

## Behavior

### When the draft agent starts

1. The page starts a draft agent only on intent (user decision, 2026-11-28: "On intent"):
   - the first focus or key press in the composer of the page,
   - a change of the folder or of the profile on the page, after the page showed.
2. The first render of the page never starts an agent. A launch of Aether starts no agent and shows no trust dialog.
3. Each window has at most one draft agent. A new draft agent closes the old one.

### The draft agent

4. The main process makes a draft ID. The draft record holds the profile, the folder, the mode and the model of the page, and the process. It has no session row and no agent run.
5. The draft agent starts with the mode and the model of the page. Approve all becomes Ask for this start (decision 0007). So it never runs in the default mode of the repository, which can be `bypassPermissions`.
6. The S6 gate runs for the folder before the start, with the draft ID. The trust dialog can show on the page. Cancel starts nothing.
7. The draft agent reads the current account of the profile at its start, but does not hold it in `starting`. An edit of that account changes the row in place (decision 0014 item 6). Aether then closes the draft agent; the next intent starts a new one.
8. A change of the folder or the profile closes the draft agent and, as rule 1 says, starts a new one.
9. Aether closes the draft agent when the page goes away without Send: another page, another session, a reload of the renderer, or quit. The main process does it: it does not trust the renderer to call it.
10. The draft agent counts for the idle limit of 6 and for the release time of 30 minutes. `retire-idle` handles draft IDs, which have no session row. A released draft agent starts again at the next intent.
11. The menu of S1 works in `SessionComposer`, with the draft ID as owner.
12. A draft agent that fails shows its notice on the page, in the problem line under the composer, as the page shows other errors today. The menu shows "Commands show when Claude Code runs.".

### Send on the page

13. Send creates the session row and passes the draft ID. `sessions.create` checks that the draft has the same profile and folder (`pathKey`), and that its account is still the current account. If a check fails, it closes the draft and the normal first start runs.
14. The new session adopts the draft agent: the process, the commands list, the "allow once" answers and the account. The owner of the listener is a mutable record, so after adoption each update, card and exit goes to the session ID.
15. Before the first prompt, Aether applies the mode and the model of the page with `configure`. If the agent refuses, Aether closes the process (it holds `GH_TOKEN`) and shows the S7 notice. No prompt goes out.
16. When the attachments add a directory outside the folder, Aether closes the draft agent at Send. The normal first start runs with all directories, after the directory question (B13).
17. When the draft agent is not ready at Send, Send waits for it. When it failed, the normal first start runs.

### The agent run and the first message

18. An early start saves no agent run at `ready`. Aether saves the agent run when the first prompt goes out. This holds for a page draft and for a draft row.
19. So the rule of the "first" message changes only a little: it is the session with no agent run. A process can exist. The retry of a first start that failed still sends the links, as decision 0012 says. The builder adds a note to decision 0012.
20. `isDraft` does not change: an early start saves no run.

### Draft rows

21. When the user opens a draft row in the session window, Aether starts its agent on open, as S2 does. It is a first start: the current account, no resume, no agent run until the first prompt (rule 18).
22. Before that start, Aether refuses an unsupported attachment kind (`unsupportedAttachment`), as `send-message` does before a first start.
23. The user can still change the mode and the model. Send applies them with `configure` (rule 15).

## Screens

No new screen.

| Moment | What the user sees |
|---|---|
| Aether starts | The page as today. No process, no dialog. |
| First click or key in the composer | Nothing new. `/` shows the last list or "Loading commands…". |
| Trust needed | The trust dialog over the page. |
| Draft agent failed | The problem line under the composer, with the notice text. |
| Send | As today. "Starting Claude Code" shows only while Send waits for a start. |

## Data

- No table, no column and no migration.
- The time of the `agent_sessions` insert moves from `ready` to the first prompt. The format does not change.

## Interfaces

- Command slice `sessions.start-draft-agent`: input `{ profileId, folder, mode, model }`, result `{ draftId }`. It returns at once. The main process reads the profile and checks the folder.
- Command slice `sessions.close-draft-agent`: input `{ draftId }`.
- `sessions.create`: optional input `draftId`. Rule 13.
- `processes.store.ts`: draft records keyed by draft ID; `adopt(draftId, sessionId)`; the mutable owner of rule 14. Each new constructor argument is optional (locked S9 test).
- `additionalDirectoriesOf` moves from `send-message/attachments.handler.ts` to a root file of the feature, because `create` needs it for rule 16.
- `agent-start.ts`: a start for a draft ID; the run saved at the first prompt (rule 18).
- Trust store: the "allow once" answers move from the draft ID to the session ID at adoption. `claudeFolderOf` takes the account of the draft for a draft ID.
- Port (`agent.port.ts`): `AgentProcess.configure(mode, model)`. The provider sends `session/set_mode` and the `model` option, as `applySettings` does. It returns `settings-refused` on a refusal.
- `retire-idle.handler.ts`: draft records count for the limit and the release time.
- Renderer: `SessionComposer.tsx` calls the two slices on intent and passes the draft ID to `onSubmit`. It uses `CommandMenu` and `useCommands` of S1.
- Decision 0015: rules 1 to 10. Decision 0012: a note for rule 19.
- `createSessionHandler({ store, clock, ids }, input)` keeps its signature for the locked S9 test.

## Terms

- "Draft agent", "draft ID". Code only.

## Error and empty states

| Case | Result |
|---|---|
| The folder does not exist | No draft agent. The folder error of today. |
| The draft agent fails | The problem line on the page. Send runs the normal first start. |
| The agent refuses the mode or the model at Send | The process closes. The S7 notice shows in the session. The user message stays, and the session has no agent run, so the next Send starts again with the links. |
| The page goes away during the trust dialog | The main process closes the dialog as a cancel. No process. |

## Locked tests of m1-chat that change meaning

Fewer than in the first draft, because nothing starts at launch. The test author lists each one in the story PR, with the trailer `Locked-Test-Change: S3 starts a draft agent on intent on the New session page (user decision 2026-11-28)`. To check:

- `s4/restart.spec.ts` 35-50, `s5/live-mode.spec.ts` 66-67, `s7/refusals.spec.ts` 93-97, `s4/provider-snapshot.spec.ts` 32: the typing on the page now starts a process before Send. The count of processes and the order of the environment reports change.
- The `s6` trust and directory tests: the dialog shows at the first key press, not at Send.
- A test that expects the agent run right after `ready`.

## Checks

| Check | Given | When | Then | Test |
| --- | --- | --- | --- | --- |
| B11 | Brief | | One `session/new`, then `session/set_mode` and the model, then the prompt. | Acceptance; live |
| B12 | Brief | | | Acceptance |
| B13 | Brief | | | Acceptance |
| S3-1 | Aether starts with a last folder | No input | No agent process and no dialog. | Acceptance |
| S3-2 | The page with a draft agent; the user chooses Plan and Sonnet | Send | `plan` and the Sonnet model before the prompt. | Acceptance |
| S3-3 | A draft agent; the agent refuses the model at Send | — | The S7 notice; no prompt; no process stays. | Acceptance |
| S3-4 | The page with a file attachment and a draft agent | Send | The first prompt has the resource link. | Acceptance |
| S3-5 | An imported draft row | Open, choose Plan, Send | One process; `plan` before the prompt; the draft prompt is sent. | Acceptance |
| S3-6 | A draft agent | The user edits the Claude folder of the profile | The account row changes in place. The draft agent closes. | Slice |
| S3-7 | A draft agent | The renderer reloads | The draft agent closes. | Slice |
| S3-8 | A draft agent of folder A | `sessions.create` with that draft ID and folder B | The draft closes; the normal first start runs in B. | Slice |
| S3-9 | A draft agent, no prompt yet | — | No `agent_sessions` row exists. | Slice |
| S3-10 | A repository whose `.claude/settings.json` sets `defaultMode: bypassPermissions` | The draft agent starts with the page mode Ask | The agent receives mode `default`. | Acceptance |

## Files and dependencies

- `src/features/sessions/agent-start.ts`, `processes.store.ts`, root file for `additionalDirectoriesOf`, `create/`, `send-message/`, `retire-idle/`
- `src/features/sessions/start-draft-agent/`, `close-draft-agent/` (new)
- `src/features/repositories/trust.store.ts`, `check-directory/`
- `src/building-blocks/agent.port.ts`, `src/providers/acp/acp-agents.ts`
- `src/app/contracts.ts`, `src/app/main/composition.ts`
- `src/renderer/src/components/SessionComposer.tsx`, `App.tsx`
- `docs/decisions/0012-session-settings.md` (note), `0015-agent-start-on-open.md`
- `tests/acceptance/m2-slash-menu/s3/` (new)
- S4 also changes `SessionComposer.tsx`, and needs the draft ID for its file list. S4 starts after S3 merges.

## Open choices

The user decided: the draft agent starts on intent (2026-11-28).

1. **Where the draft agent lives.** Hot item: it touches several modules.
   - A (recommended): a draft ID in memory. No row before Send. Impact: no saved format change; adoption code.
   - B: a hidden session row. Impact: a new column (saved format) and a cleanup after a crash.
2. **Mode and model of an early agent.** A (recommended): start with the page values (never Approve all), then `configure` once at Send. B: restart the draft agent at each change.
