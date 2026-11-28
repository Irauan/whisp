# m1-chat: advisor decisions to review

Status: written by the coordinator on 2026-11-27, from the "Advisor decisions" of each merged story PR. See "Escalation" in `docs/process.md`.

The user reads this list at acceptance. A veto becomes a failing check and a new story. User decisions made during the execution are in `docs/user-preferences.md`.

S1 to S4, S6 and S7 ran before the story-spec process. Their advisor decisions are in PRs #23 to #28 and in the coordinator log.

## S8 Frame, composer and plan widget (PR #35, squash `a92cb98`)


From the test author:

1. The model button of the session window has the exact name "Model". Its text is the model label, and it opens the group "Model".
2. "Coming soon" on "Add context" is its accessible description (the `title`). The name stays exactly "Add context".
3. The first plan of a session shows no "Updated the plan". An empty plan shows one.
4. The fold-out "Show log" starts closed.
5. "Muted" means the computed text color equals the resolved `var(--muted)`.

From the builder:

6. The "Attachments" panel goes at the top of the scroll area, before the first entry, in a draft and in a started session. In a started session it is a child of the log, because no wrapper may scroll. Reason: the frame, the header and the dock contents are approved, and the panel goes with the first message. Not hard to revert. The user likely agrees.
7. (Changed in rework 1, by the coordinator.) The fold-out "Show log" holds the last log lines of a stopped agent and of a failed start. The provider writes them after the marker line "Last log lines:" (`LOG_MARKER`, `src/shared/log-marker.ts`), and `splitFailedTurn` in `session-view.ts` splits at it. A notice without the marker, such as the sign-in steps, stays whole. No entry schema change. The split lives in the renderer, because the renderer may not import `entry.ts`. Not hard to revert.


## S9 Idle release and process limit (PR #40, squash `c485a92`)


From the test author (copied):

1. The vitest files live in `tests/architecture/`, because `tsconfig.main.json` typechecks only that folder.
2. S9-4 is an acceptance test.
3. The names `sessionsToRetire`, `RELEASE_LIMITS` and `retireIdleHandler(deps: { store, transcript, processes, clock, limits, log }): Promise<void>` are fixed by the tests. The handler promise resolves when the closes it started have ended.
4. New deps members are optional.

From the builder:

5. Overlap of rule 1 and rule 2 in one pass. Rule 1 runs first. Rule 2 then counts only the idle sessions that rule 1 keeps, and closes the oldest of those until 6 stay. The function returns the union. Reason: "until 6 stay" is literal. Not hard to revert. The user likely agrees: nothing in m1 writes `automation`, so both readings behave the same in the product. A unit test covers it.
6. `SendMessageDeps` gets an optional `turnEnded()` callback, fired without an `await`, with a logged catch. The composition root connects it to the release (rule 2).
7. Open choice 3, rule D, runs in the `update` listener of `startProcess`: an agent update outside a turn restarts the idle time.
8. `retireIdleHandler` takes an optional `openRequests(sessionId)`. It counts 0 until S5 passes it.
9. The process tree list uses PowerShell and `Get-CimInstance Win32_Process`, with no new library. `wmic` is not on the machine.
10. `startedBy` stays out of `sessionSchema`, the output of `sessions.list` and `sessions.open`. The spec says no new contract and no renderer access. zod validates the value in `insert` and in `startedByOf`. Not hard to revert.
11. The tree list does nothing off Windows. CI and the architecture target Windows. Listed as a gap.
12. Time limit of tests with real agent closes. Each close now lists the process tree, so the real-agent test of `composition.test.ts` (two closes) timed out at 5 s on CI. It and the acp-agents test "resumes the agent session of the input in a new process" (two closes) got an explicit limit of 30 s. No assertion changed, and neither file is locked. This is unit test design, not a weaker gate. Not hard to revert. The advisor first said to fix it on the product side with a parallel snapshot, then withdrew that: it saves nothing for an idle process, and session close could end the Claude process before the list is read, so its children would be missed.
13. User decision 2026-11-27: force-kill the tree when the list fails. When the list of the process tree fails or times out, Aether logs it and ends the agent and its whole tree with `taskkill /T /F` (full `System32` path, 5 s limit) instead of the normal close. It runs while the agent root still runs, so `/T` finds the children, and it skips the close of the session and of stdin. The process still counts as closed for the next start (rules 7 and 8): the close resolves and the exit is reported. This replaces the earlier advisor answer (log and finish the normal close), which needed the user. The limit of a PowerShell call and of `taskkill` is 5 s. `src/main/index.ts` passes no log, so the default is `console.error`. A unit test covers the path (commit `763ca58`).
14. Rework 1, order (S2). The cancel notify and the list start in the same synchronous step. Both are awaited, then the session closes, then stdin. This replaces the order in decision 12: the cancel now comes before the list ends, and the list still comes before the close of the session and stdin.
15. Rework 1, quit limit (M2). Bound every step and keep `QUIT_LIMIT_MS` at 30 s. `taskkill` got a 5 s limit, and the full `System32` path.
16. Rework 1, root check (L1). The root must have started between the `spawn()` call and the `spawn` event. The upper bound is the `spawn` event, not the time of the close, because a process that reused the number is always newer than the spawn.


## S5 Permission queue (PR #42, squash `8ed051a`)


From the test author:

1. Slice rows are locked vitest tests through `composeMain` and `createInvoke`. They fix contracts, snapshot fields, changes and the `answers` format, not handler names.
2. `holdAnswers` wraps Electron's private `ipcMain._invokeHandlers`. An Electron upgrade can break it.
3. An extra S5-28 acceptance test checks the withdrawn, exited and quit texts after a restart.
4. The changed simulated-agent files keep the story `m0-gates/s4`.
5. Primary means a background of `--fill`. Secondary and primary colors mean `--muted` and `--text`.

From this build (the advisor accepted each; none is hard to revert, and the user likely agrees):

6. The window shows the live mode and the model of the refusal fallback through events, not a reload. The change `mode` sets `liveMode`, and the change `model` sets `session.model`. Both go through `Transcript`, so the revisions stay in one sequence. The agent-reported value beats the choice of the draft.
7. The request of the real adapter names only `toolCallId`, `title` and `rawInput`. `providers/acp` remembers the kind, title and locations of each earlier `tool_call` by its ID. Precedence: the fields of the request, then the remembered call, then the fallback. The fallback is `toolKind: null` and no locations. The card then shows the title alone ("Tool call" when the request has none), and the question "Allow this tool?". Tested in `acp-agents.test.ts`.
8. The recipe of `providers/claude-code` classifies a form once (`formFacts`). The port `Elicitation` carries `recommended`, `keepsText`, and for a text field `completes` (the choice that it completes). The view carries `recommended` and `completes`. `_custom` and `retry_fallback` appear only in the recipe.
9. Two buttons show only for a form with a recommended option (the refusal fallback). Any other single select keeps its rows with "Submit" and "Skip".
10. The trust question carries `repositoryRoot` and `workspaceDirectory` besides `holdsWorkspace`, because the warning names the workspace directory. They live in memory.
11. A request with no options gets the option "Cancel request" from the provider. It answers `cancelled`.
12. A request that the agent withdraws is answered `cancelled`. Otherwise the agent waits for ever (S5-2).
13. `cancel` sends `session/cancel` first, then answers `cancelled` to each request that the agent did not withdraw (the order of the spec). The agent then ends the turn as cancelled and the transcript shows "Stopped.".
14. `recordRequest` of `SendMessageDeps` is optional, and `openRequests` of `RetireIdleDeps` is required in its type but the handler counts zero when a caller passes none. The locked S9 test builds both deps without them (`m1-chat-s9-retire-idle.test.ts` lines 186 and 224).
15. A `mode` change goes out only when the shown mode changes. The live mode clears when the process leaves (a crash, a release or a close), through a hook of `Processes`.
16. In a single select, the row "Other" is exclusive with the options. Typing in its field selects it.
17. Card styles sit in a CSS module (`Cards.module.css`), as in S8.
18. The simulated agent answers a request before it sees the withdraw. The first close wins: Stop saves `stopped` before it cancels, so a later `$/cancel_request` changes nothing (S5-29).
19. S9 wiring: `openRequests` goes from `composition.ts`, and the last card that closes outside a turn calls `processes.markIdle`. A release never closes a shown card.
20. A form with no fields gets the error -32602 (`forms.ts`): there is nothing to render, and the agent then cancels it.
21. A two-option MCP form keeps its rows with "Submit" and "Skip". The user named buttons only for the binary cases of Claude (the refusal fallback), and `docs/user-preferences.md` pattern 12 says to apply a UI rule only to the case that the user named.
22. The worktree needed its own `npm ci`: the parent `node_modules` lacks the dev tools.

