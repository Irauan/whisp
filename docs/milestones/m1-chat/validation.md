# Milestone m1-chat: validation

Status: step 7 of `docs/process.md`, round 1, on 2026-11-27. Validator run 1 of the 2 in the budget. Round 2 (S10, S11 and PR #53), on 2026-11-28, is at the end of this file: see "Round 2: second pass".

- Head: `milestone/m1-chat` at `f4eb2f2`, fetched over HTTPS. All 9 stories are merged.
- Machine: Windows 11, Node 24.22, Electron 45.5 (`npm ci`, then `node node_modules/electron/install.js`), adapter `@agentclientprotocol/claude-agent-acp` 0.112.0.
- Every run used a temporary data folder. The real Aether data folder was not written. See "Data folder".
- Paths in this file use `<temp>` for the temporary folder of the machine.
- On the coordinator's instruction, this one file holds the evidence and the metrics of step 7.

## Result

- Each check A1 to A22 has evidence. All pass.
- The regression passes in full: gates, 1077 vitest tests and 115 acceptance tests.
- The seven live checks ran with real Claude through the user's subscription sign-in (decision 0011). All seven pass.
- Two parts of the live checks could not show the exact case live. Both pass in CI. See "Gaps of the live run".
- No serious finding is open. Three low findings and one note are open. See "Findings".

Verdict of the validator: PASS, with the two live gaps for the coordinator to accept or route.

## Regression

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | Passed: main, renderer, shared and test configs |
| Lint | `npm run lint` | Passed |
| Architecture | `npm run architecture` | Passed |
| Unit, slice, contract and architecture tests | `npm test` (vitest, verbose) | 76 files, 1077 tests, 1077 passed, 0 skipped, 78 s |
| Test lock | `npm run lock -- --base origin/milestone/m1-chat` | Passed |
| Build | `npm run build` | Passed |
| Full acceptance suite | `npx playwright test` after the build (the two parts of `npm run acceptance`) | 115 tests, 115 passed, 0 failed, 4.9 min, one worker, hidden windows |

- The full suite ran in one call, under 10 minutes. No run folder by folder was needed.
- The folders `m0-gates/s8` and `m1-chat/s1` to `s3` also ran alone first: 6, 3, 8 and 11 passed.
- Acceptance count by folder: m0-gates s8 6, s1 3, s2 8, s3 11, s4 11, s5 23, s6 15, s7 21, s8 15, s9 2.

### CI on the milestone branch

- Run 46079869111 ran on `8ed051a` (S5), not on the head. Attempt 1 failed in `unit`. Attempt 2 was cancelled by the concurrency group. That run never passed.
- Run 46080527540 on the head `f4eb2f2` passed all six jobs. It is a push run, so its acceptance job ran only the spec folders that the push touched.
- So the local run above is the only full-suite evidence at the head.

### The failed unit test of run 46079869111, attempt 1

- Test: `src/building-blocks/migrations.test.ts` line 202, "version 3 adds the trust answers and the allowed directories of a profile, and removes them with the profile".
- On CI it took 8788 ms against the vitest limit of 5 s. Its file took 10246 ms. Its neighbours took 355 ms and 1067 ms on the same runner.
- Locally it took 65 ms in the full run, and 33 to 36 ms in five runs of its file alone.
- Its body opens a file database twice, makes one backup copy before the migration (`src/building-blocks/database.ts` 231-241), runs a few inserts and one delete. It has no wait, no timer and no retry.
- Conclusion: the test is not slow by design. It is a load-sensitive flake of disk work on the CI runner. Finding F1.

## Checks of the brief

A live check needs both its CI test and its live run. All CI tests named below passed at `f4eb2f2`.

| ID | Evidence in CI (simulated agent) | Live (real Claude) | Result |
|---|---|---|---|
| A1 | `s4/chat.spec.ts` "A1 and G11: the reply to "Say hello" streams into the session window in R/repo-a, the entries are saved, and the app runs in a temporary data folder" | L1, L2 | PASS |
| A2 | `s4/chat.spec.ts` "A2: "Say it again" gets its reply in the same agent session" | L1 | PASS |
| A3 | `s4/chat.spec.ts` "A3: Stop during a long reply with an open tool call shows "Stopped.", the tool call failed, and a ready composer" | L3 | PASS |
| A4 | `s5/queue.spec.ts` "A4: two permissions at the same time show two cards; Allow on the first and Refuse on the second reach the agent, each for its own request" | L4 | PASS |
| A5 | `s5/queue.spec.ts` "A5: Stop with two open requests shows both cards as not answered, with "Not answered: you pressed Stop.", and the agent receives cancelled" | — | PASS |
| A6 | `s4/restart.spec.ts` "A6: after a restart, the session shows both turns, and the next message resumes the same agent session" | L1 | PASS |
| A7 | `s4/processes.spec.ts` "A7: two sessions in two folders that send before any process is ready both get replies, each from its own process" | — | PASS |
| A8 | `s4/sign-in.spec.ts` "A8: "auth required" shows "Claude Code is not signed in." and the sign-in steps, and Aether goes on" | L5 | PASS |
| A9 | `s6/trust.spec.ts`, 6 tests: question and Cancel (no process, the hook does not run), Trust, one repository, plain folder and Cancel, plain folder and Trust, per profile | — | PASS |
| A10 | `s6/directories.spec.ts`, 9 tests: outside and Cancel, once, always, another profile, no workspace directory, "..", sibling folder, junction, letter case | — | PASS |
| A11 | `s8/plan-widget.spec.ts` "A11: the widget shows "Plan 1 of 3" with a completed step, a step in progress and a pending step, and the same plan after a restart" | — | PASS |
| A12 | `s7/settings.spec.ts`, 7 tests: Opus 5.5 and Ask give `claude-opus-5-5` and `default`; Accept edits, Plan, Auto and Approve all give their modes; Default sends no model; Auto with a model that cannot use it shows the notice | L6 | PASS, with gap G-L2 |
| A13 | `s3/settings-menu.spec.ts`, 4 tests: five modes, no Tool permissions control, Worktree and the session attachment "coming soon" and disabled | — | PASS |
| A14 | `s3/new-session-mode.spec.ts`, 4 tests: after Approve all Ask, after Auto Auto, the last session of the current profile, the sequence Auto then Approve all | — | PASS |
| A15 | `s7/attachments.spec.ts` "A15: the first message has a resource link for the file and for the folder outside the session folder, and the folder is an additional directory", and 5 tests in `s7/directories.spec.ts` | — | PASS |
| A16 | `s4/environment.spec.ts` "A16: the agent gets neither ANTHROPIC_API_KEY nor FOO of Aether, and GH_TOKEN of the GitHub account of the profile" | — | PASS |
| A17 | `s2/import.spec.ts`, 6 tests: the directory dialog, 2 profiles and 3 sessions with the import modes, Assisted to Auto, old files byte-equal, the GitHub account | — | PASS |
| A18 | `s2/unreadable-files.spec.ts`, 2 tests: an unreadable `workspace.json` and an unreadable database are kept aside, a message shows, nothing is overwritten | — | PASS |
| A19 | `s1/coming-soon.spec.ts`, 3 tests: Projects and Work items show "Coming soon" | — | PASS |
| A20 | `s4/restart.spec.ts` "A20: when the agent process exits during a turn, a notice shows the exit code and the last log lines, and the next message starts a new process and resumes" | — | PASS |
| A21 | Slice `tests/architecture/m1-chat-s9-retire-idle.test.ts` "A21: the process stays 1 ms before 30 minutes of idle time, closes …" (test clock, simulated agent over real ACP) | — | PASS |
| A22 | `s9/process-limit.spec.ts` "A22: the seventh idle process closes the oldest idle one, never the active session, and the oldest idle one closes again when the active turn ends" | — | PASS |

## Checks of the story specs

All passed at `f4eb2f2`. "Acc" is the acceptance suite, "vitest" is `npm test`.

| Check | Evidence | Result |
|---|---|---|
| S5-1 | Acc `s5/queue.spec.ts` "S5-1: the user answers the second card first, and each request gets its own answer" | PASS |
| S5-2, S5-3, S5-4, S5-29 | vitest `tests/architecture/m1-chat-s5-permission-queue.test.ts`, group "S5-2, S5-3, S5-4 and S5-29: one request at a time", 4 tests | PASS |
| S5-5 | vitest same file, "S5-5: a request after the turn shows a card, Stop cancels it, and the agent receives cancelled". Also live, L4 part 3 | PASS |
| S5-6, S5-20, S5-24, S5-26, S5-27 | Acc `s5/decision-cards.spec.ts`, 5 tests | PASS |
| S5-7, S5-15 | Acc `s5/live-mode.spec.ts`, 2 tests | PASS |
| S5-8, S5-16 | vitest group "S5-8 and S5-16: the live mode", 2 tests | PASS |
| S5-9, S5-10, S5-21, S5-22, S5-23 | Acc `s5/question-cards.spec.ts`, 5 tests | PASS |
| S5-11, S5-12, S5-25 | vitest group "S5-11, S5-12 and S5-25: elicitations", 3 tests | PASS |
| S5-13, S5-14 | Acc `s5/trust-root.spec.ts`, 3 tests | PASS |
| S5-17, S5-18, S5-19 | Acc `s5/queue.spec.ts`, 3 tests | PASS |
| S5-28 | vitest group "S5-28: the reason of each close", 2 tests, and Acc `s5/closed-cards.spec.ts` "S5-28: a withdrawn card, a card of an agent that exited and a card open at the quit show their reasons, also after a restart" | PASS |
| S5-30, S5-32 | vitest group "S5-30 and S5-32: the entry of a card and the changes that carry it", 2 tests | PASS |
| S5-31 | Acc `s5/closed-cards.spec.ts` "S5-31: after a kill of Aether with a card open, the next start changes the saved outcome open to interrupted …" | PASS |
| S8-1, S8-2 | Acc `s8/plan-widget.spec.ts`, second and third test | PASS |
| S8-3, S8-4, S8-5 | Acc `s8/plan-updates.spec.ts`, 3 tests | PASS |
| S8-6, S8-7 | Acc `s8/model.spec.ts`, 3 tests, and vitest `src/features/sessions/set-model/set-model.test.ts`, 4 tests | PASS |
| S8-8 | Acc `s8/failed-turn.spec.ts` "S8-8: the agent exits with exit code 7 and a log line …" | PASS |
| S8 frame and composer | Acc `s8/frame.spec.ts`, 4 tests, and `s8/composer.spec.ts`, 1 test | PASS |
| S9-1, S9-2 | vitest `tests/architecture/m1-chat-s9-idle-release.test.ts`, 6 and 5 tests | PASS |
| S9-3 | vitest `tests/architecture/m1-chat-s9-retire-idle.test.ts` "S9-3: a message that comes while the released process closes starts no process before the close ends …" | PASS |
| S9-4 | Acc `s9/child-process.spec.ts` "S9-4: when the idle limit releases the process whose agent started a child process, the child process ends too", and vitest `src/providers/acp/acp-agents.test.ts` (S9-4) | PASS |
| S3 create, open, delete | Acc `s3/sessions.spec.ts`, 3 tests | PASS |
| S4 mode, provider snapshot | Acc `s4/mode.spec.ts` and `s4/provider-snapshot.spec.ts` | PASS |
| S7 refusals, decision 0011 | Acc `s7/refusals.spec.ts`, 4 tests, and `s7/claude-account.spec.ts`, 4 tests | PASS |
| G11, G12 (replaced by S4) | Acc `s4/chat.spec.ts` "A1 and G11 …" and "G12 …" | PASS |
| G18, G19 (m0-gates) | Acc `m0-gates/s8`, 6 tests | PASS |

## Live run

### Setup

- A Playwright harness launched the built app (`out/`) with `--user-data-dir=<temp>\aether-live-*\data` and the hidden-window arguments.
- It wrote no `agents.json`, so the built-in Claude Code adapter ran.
- `APPDATA` pointed to a temporary folder. `USERPROFILE` stayed real, so Claude used the existing sign-in in the user's Claude folder.
- The harness removed each `CLAUDE*`, `ANTHROPIC_*`, `GH_TOKEN` and `GITHUB_TOKEN` variable from the app environment.
- The profile "Personal" came from an old `workspace.json` with no GitHub account, so Aether read no token.
- The harness lived in an ignored folder and is not part of this PR. It printed and saved no token.
- Evidence came from the window text, screenshots (not attached: they show local paths), a read-only copy of the temporary database, and counts from the Claude session file of each agent session.

### Results

| Run | Checks | What the validator saw | Result |
|---|---|---|---|
| L1 | A1, A2, A6 | See "L1 in detail". | PASS |
| L2 | A1 (streaming) | A reply of about 2100 characters grew in 91 steps in the transcript while the turn ran. The database saved one joined agent entry. | PASS |
| L3 | A3 | Mode Approve all. A sentence streamed, then the tool call `ping -n 60 127.0.0.1` showed "Pending". Stop: "Stopped." showed, the tool call showed "Failed", Stop left, and Send took a new message. No ping process remained. | PASS |
| L4 | A4 and the S5 reviewer note | See below. | PASS |
| L5 | A8 | Claude folder set to an empty temporary folder. The alert showed "Claude Code is not signed in. Sign in with your Claude subscription. Open a terminal. Set CLAUDE_CONFIG_DIR to <temp>\…\claude-empty. Run `npx @agentclientprotocol/claude-agent-acp --cli auth login --claudeai`. Then send your message again." A second send showed the alert again, and the app kept running. The command matches the adapter's own sign-in method (`auth-methods.js` 52: `--cli auth login --claudeai`). | PASS |
| L6 | A12 | See "L6 in detail". | PASS, with gap G-L2 |

### L1 in detail (A1, A2, A6)

1. "Starting Claude Code" showed after Start session.
2. "Say hello" got "Hello! What can I help you with?". No notice showed.
3. "Say it again" got "Hello again! What can I help you with?".
4. The database then held 4 entries (user, agent, user, agent) and one `agent_sessions` row.
5. After a quit and a start, the opened session showed both turns.
6. "Repeat my first message word for word, and nothing else." got "Say hello". No notice showed.
7. The same single `agent_sessions` row, with the same agent session ID, remained.
8. The Claude session file of that ID held 3 user messages, mode `default` and model `claude-opus-5-5`. So the resume continued the same agent session.

### L6 in detail (A12)

- Each case was a new session with one tiny prompt. Each started and replied with no notice.
- The Claude session file of each agent session gave the mode and the model that Claude used:

| Aether model and mode | Claude model | Claude permission mode | Mode control |
|---|---|---|---|
| Opus 5.5, Ask | `claude-opus-5-5` | `default` | Ask |
| Opus 5.5, Accept edits | `claude-opus-5-5` | `acceptEdits` | Accept edits |
| Opus 5.5, Plan | `claude-opus-5-5` | `plan` | Plan |
| Opus 5.5, Auto | `claude-opus-5-5` | `auto` | Auto |
| Opus 5.5, Approve all | `claude-opus-5-5` | `bypassPermissions` | Approve all |
| Haiku 5.5, Auto | `claude-haiku-5-5` | `auto` | Auto |
| Fable 5.2, Auto | `claude-fable-5-2` | `auto` | Auto |

- The model button showed the chosen model in each case.

### L4 in detail (A4, and the S5 reviewer note)

1. Two shell commands (`mkdir alpha`, `mkdir beta`) in mode Ask. Claude asked one after the other, not at the same time.
   - The card showed the context line "execute · mkdir alpha", the question "Run this command?", the target path, and the buttons "Yes" and "No".
   - So the shell request title is the command, and the context line holds the kind and the title, as the S5 spec says. The fallback "Allow this tool?" of S5 decision 7 did not show.
   - "Yes" on the first and "No" on the second: `alpha` exists, `beta` does not. The tool calls showed "Completed" and "Failed".
2. Two reads of files outside the session folder, in parallel. Two cards were open at the same time, each "read · Read <temp>\…\first.txt" (and `second.txt`), "Read this?", a "Yes" split button with "More allow options", and "No".
   - "Yes" on the first card and "No" on the second. The first read showed "Completed", the second "Failed".
   - Claude answered "I saw one fruit: apple, from `first.txt`. I didn't see `second.txt` because you declined permission to read it."
   - The four answered cards stayed in the transcript as "Permission answered", with "Yes", "No", "Yes", "No".
   - So each answer reached its own request. This is the A4 case live.
3. A request outside a turn. Claude ran `sleep 20` in the background and ended its turn.
   - At 6 s the turn ended: no Stop and no "Working".
   - At 27 s a card "execute · mkdir gamma" showed. The status line showed "Waiting for your answer", and Stop showed.
   - The Claude session file shows the wake-up as a new cycle with the origin `task_notification`, after the stop hook of the first cycle.
   - "Yes" ran the command, and the tool call showed "Completed".

### Gaps of the live run

- G-L1 (A4, part 1): two parallel shell commands came as two cards one after the other, because Claude asks for them in turn. Part 2 shows two cards at the same time with reads, so A4 holds live.
- G-L2 (A12): the Auto fallback notice could not show live. Opus 5.5, Haiku 5.5 and Fable 5.2 all ran in `auto`, and Default is Opus. No model in the list of Aether lacks Auto today.
  - This is a gap, not a block. The brief, "Assumptions and risks", gives the live part of A12 to "The adapter accepts the model and the permission mode before the first message". L6 shows it.
  - The same table gives "Some models cannot use `auto`" to the A12 fallback check. The CI test "A12: Auto with a model that cannot use it shows the notice that Claude uses Accept edits" passed.

## Data folder

- The harness listed the real Aether data folder (21 entries, with sizes and times) before and after each live run. It was unchanged after all 9 runs.
- The acceptance suite checks the same rule (G11) in each S4-based test, and it passed.
- The live sessions ran in the user's Claude folder. So Claude wrote its session files there, and the user's own Claude hooks ran. The validator did not change or clean that folder.
- The validator removed its temporary folders after the run. No process of the runs remained.

## Decisions to review

The validator read `decisions-to-review.md` against the brief, the architecture and the specs. No decision conflicts with the brief or a spec.

- S5 decision 7 (fallback "Allow this tool?" when a request has no kind): live, the real shell and read requests had their kind, through the remembered tool call. The fallback did not show.
- S5 decisions 14 and 19 against S9-2: `src/app/main/composition.ts` 183 passes `openRequests: (id) => transcript.openCardCount(id)` to `retireIdleHandler`. It is the only caller. So an open card keeps a session busy, as S9-2 needs.
- S8 decision 3 (the first plan shows no "Updated the plan"): the brief speaks only of a new plan that replaces an old one, so the two agree. The S8 spec lists it under "Conflicts between the locked tests and the brief", point 5.
- S9 decision 12 (a 30 s limit on two unit tests): no assertion changed and neither file is locked. It does not weaken a gate.
- S9 decision 11 (the tree list does nothing off Windows): the brief allows Windows 11 only.
- The file has no decisions of S1 to S4, S6 and S7. It points to PRs #23 to #28 instead. Step 5 of "Escalation" says the coordinator copies the decisions of each merged story. See finding F2.

## Findings

No serious finding is open.

| ID | Severity | Finding | Evidence | Suggested route |
|---|---|---|---|---|
| F1 | Low | The unit test "version 3 adds the trust answers …" flakes on CI under load: "TestTimeoutError: Test timed out in 5000ms." after 8788 ms. Locally it takes 33 to 65 ms. It is not slow by design. | CI run 46079869111 attempt 1, job `unit`; `src/building-blocks/migrations.test.ts` 202; local runs above | Fix PR: give the file-database tests of this file a limit that fits a loaded runner, as S9 decision 12 did. |
| F2 | Low | `decisions-to-review.md` holds no advisor decisions of S1 to S4, S6 and S7. The user reads only this file at acceptance. | `docs/process.md`, "Escalation" step 5; `decisions-to-review.md` line 7 | Coordinator copies them from PRs #23 to #28, or the user accepts the pointer. |
| F3 | Low | The budget in the brief says 55 agent runs. `user-preferences.md` records the user's cap of 62, then 75. The brief was not updated. | `brief.md`, "Budget"; `user-preferences.md`, "Run cap of m1" | Coordinator updates the brief and reports the run count. |
| N1 | Note | The Auto fallback notice cannot show live with today's models (G-L2). | L6 | None now. Recheck when a model without Auto appears. |

## Accepted gaps

From the brief:

- Live checks and acceptance waited for decision 0011. Decision 0011 is accepted, and the live checks ran.
- Between S2 and S3, session drafts were read-only. Both are merged, so the gap is closed.

From the architecture and the decision records:

- A fully compromised renderer could still answer a permission question.
- Trust stays after the files change: a hook that a later commit adds runs without a new question.
- After an approval, an agent shell command can reach any directory of the user.
- A background shell command of the agent does not count as busy. It ends with its process after the release time (user, 2026-11-27).
- Two cases escape the kill of the process tree: a crash of the agent, and a child that starts after the list.
- The process tree list does nothing off Windows (S9 decision 11).
- Processes and open questions live in memory only. A turn does not survive a restart of Aether.
- Playwright for Electron is experimental, and `node:sqlite` is a release candidate.

## Role duties that do not apply

- The m1 plan lists no red PR per gate and no G16 pushes. This run opened no red PR and tried no push.

## Metrics

From the files of the milestone. The coordinator holds the count of agent runs.

| Metric | Value |
|---|---|
| Defects after acceptance | None yet: acceptance is step 8 |
| Rejections | 0 |
| Rework | S5 rebuilt once (PR #42 replaced the first story branch). S8 rework 1 (S8 decision 7). S9 rebuilt once (PR #36 closed, PR #40 merged), with rework 1 (S9 decisions 14 to 16). |
| Late finds by round | Step 7 round 1: no product finding. F1 is a test flake, F2 and F3 are records. |
| Test disputes | 1: the `killApp` helper of S5-31, resolved by `f72b86d` (PR #42) |
| Escalations | The user answers of 2026-11-27 in `user-preferences.md` |
| Agent runs against budget | Validator: 1 of 2. Milestone total: not in the files. Budget: 55 in the brief, 75 in `user-preferences.md` (F3). |

## Round 2: second pass

Status: step 7 of `docs/process.md`, round 2, on 2026-11-28. Validator run 2 of the 2 in the budget of the brief.

- Head: `milestone/m1-chat` at `98d923e`, fetched over HTTPS, detached checkout.
- New since round 1 (`f4eb2f2`, report `02136b2`):
  - PR #46 (`0056caf`): composer focus ring. CSS only.
  - S10 Session title and menu (PR #48, `dcfb310`): check A23.
  - S11 Sidebar folders and session status (PR #52, `481930d`): checks A24 and A25.
  - PR #53 (`98d923e`): S11 review fixes. It had no separate review. This pass reviews it. See "Review of PR #53".
- Machine: Windows 11, Node 24.22, Electron 45.5 (`npm ci`, then `node node_modules/electron/install.js`), adapter `@agentclientprotocol/claude-agent-acp` 0.112.0.
- Every run used a temporary data folder. The real Aether data folder was not written. See "Data folder, round 2".

### Result, round 2

- Each check A1 to A25 has evidence. All pass.
- The regression passes in full, locally and in CI: gates, 1167 vitest tests and 142 acceptance tests.
- The live run with real Claude passes: A23, A25, the live parts of A24, and A1 as a smoke test.
- The review of PR #53 found no defect.
- No serious finding is open. Four low findings and three notes are open. See "Findings, round 2".

Verdict of the validator: PASS.

### Regression, round 2

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | Passed: main, renderer, shared and test configs |
| Lint | `npm run lint` | Passed |
| Architecture | `npm run architecture` | Passed |
| Test lock | `npm run lock -- --base origin/milestone/m1-chat` | Passed |
| Unit, slice, contract and architecture tests | `npx vitest run` | 89 files, 1167 tests, 1167 passed, 0 skipped, 86 s |
| Build | `npm run build` | Passed |
| Full acceptance suite | `npx playwright test` after the build | 142 tests, 142 passed, 0 failed, 6.7 min, one worker, hidden windows |

- Acceptance count by folder: m0-gates s8 6, s1 3, s2 8, s3 11, s4 11, s5 23, s6 15, s7 21, s8 15, s9 2, s10 9, s11 18. Round 1 had 115. S10 adds 9 and S11 adds 18.

#### CI on the milestone branch, round 2

- Run 46114727699: a manual run (`workflow_dispatch`) on `98d923e`. All six jobs passed: typecheck, lint, architecture, unit, lock, acceptance.
- Its acceptance job printed "acceptance-scope: full suite" and ended with "142 passed (6.4m)". So CI ran the full suite at the head, with the same count as the local run.
- The CI runners are `windows-latest`. So the win32-only tests of PR #53 ran in CI too.
- Push run 46114628864 on the same `98d923e` shows "cancelled". The manual run cancelled it through the concurrency group `ci-<workflow>-<ref>`. It is not a failure.

### Checks of the brief, round 2

Only the new checks and the checks that ran again live are in detail. S10 and S11 changed shared code that A2 to A22 use, for example `send-message.handler.ts`, `transcript.store.ts`, `session.store.ts` and `App.tsx`. The CI tests of A2 to A22 passed again in the full suite at `98d923e`. See also "Locked tests changed since round 1".

| ID | Evidence in CI (simulated agent) | Live (real Claude) | Result |
|---|---|---|---|
| A1 | `s4/chat.spec.ts` "A1 and G11: …" | R2-L1 | PASS |
| A2 to A22 | As in round 1. All passed in the full suite at `98d923e`, locally and in run 46114727699. | Round 1 (L1 to L6) | PASS |
| A23 | `s10/title.spec.ts`: S10-1 (title during the turn, window and sidebar, after a restart), S10-2 (title outside a turn), S10-3 (title of a session that is not open). `s10/rename.spec.ts`: S10-14 (a title from Rename stays, also after a restart; a later agent title changes nothing). `s10/strip.spec.ts`: S10-10, S10-11, S10-12, S10-13, S10-15. vitest: S10-4 to S10-9, S10-16. | R2-L2 | PASS |
| A24 | `s11/groups.spec.ts`: S11-1, S11-2, S11-3 (collapse with click, Enter, Space), S11-4 (the "+" of a group sets the folder of the composer), S11-16. `s11/folders.spec.ts`: S11-13 (collapse after a restart and a profile switch), S11-14 (the "+" menu), S11-15 (an added empty folder stays after a restart, and "Remove folder" removes it), S11-24 (the folder menu). vitest: S11-18, S11-19. | R2-L4 | PASS, with finding F4 (a test gap, covered live) |
| A25 | `s11/status.spec.ts`: S11-5 (Working and its animation, none with reduced motion), S11-6 (New answer while another session is open; the open clears it), S11-7, S11-8, S11-9 (the mark after a restart), S11-10 (the hand, and no hand after a withdraw), S11-11 (the collapsed groups), S11-12. `s11/viewing.spec.ts`: S11-21. vitest: S11-17, S11-20, S11-22, S11-23. | R2-L3 | PASS |

### Locked tests changed since round 1

The validator read `git diff f4eb2f2..98d923e -- tests/`. Besides the new folders `s10` and `s11`, the new `tests/architecture/m1-chat-s10-*` and `m1-chat-s11-*` files and `tests/locks.json`, four locked files changed:

| File | Change | Allowed by | Trailer | Meaning |
|---|---|---|---|---|
| `s3/sessions.spec.ts` | "Delete session" is the item "Delete" or "Discard draft" of the menu "Session options". The same dialog, Cancel and delete checks stay. | S10 spec, "Locked tests that change" | `dcfb310`: "S10 moves the title and Delete session into the title strip and its menu (user decision 2026-11-28)" | Kept: Delete asks first |
| `s8/frame.spec.ts`, `s8/frame.ts` | The header row is gone. The title and "Session options" are in the strip, fully in view, and "Session options" is the only button above the log. | S10 spec, "Locked tests that change" | Same trailer in `dcfb310` | Kept: the title is in view, no facts row |
| `s3/fixture.ts` | `openNewSession` uses the row "New", because the "+" of "Sessions" opens a menu from S11. It also checks the New page. | S11 spec, "Locked tests" (the trailer rule) | `481930d`: "S11 sidebar folders and status (user decision 2026-11-28): the + of Sessions opens a menu, so the helper uses the New row" | Kept: a helper opens the composer of a new session |

No locked test changed its meaning. Each change has its trailer and follows the spec.

### Live run, round 2

#### Setup, round 2

- A Playwright harness launched the built app (`out/`) with the hidden-window arguments of the acceptance suite.
- `AETHER_DATA_DIR` pointed to a new folder `<temp>\aether-live2-*\data`. The harness checked that `aether.db` was in that folder after the first start, before any prompt.
- `APPDATA` pointed to a temporary folder. `USERPROFILE` stayed real, so Claude used the existing subscription sign-in (decision 0011).
- The harness removed each `CLAUDE*`, `ANTHROPIC_*`, `GH_TOKEN` and `GITHUB_TOKEN` variable from the app environment. It wrote no `agents.json`, so the built-in Claude Code adapter ran.
- The profile "Personal" came from an old `workspace.json` with no GitHub account and two drafts, one in `repo-a` and one in `repo-b`. Both are plain folders in the workspace directory.
- Each new session started from the "+" of the group `repo-a` ("New session in repo-a").
- The harness set the window focus with `emit('focus')`, as the S11 tests do, because the hidden window starts with no focus.
- Evidence came from the window, screenshots (not attached: they show local paths), and read-only copies of the temporary database.
- The harness lived in an ignored folder and is not part of this PR. The first attempt failed in the harness itself (a wrong locator), before any prompt. The second attempt ran all steps.

#### Results, round 2

| Run | Checks | What the validator saw | Result |
|---|---|---|---|
| R2-L1 | A1 (smoke) | "Say hello" got "Hello! What can I help you with?" in about 20 s, with the process start. No alert showed. The database held one user entry, one agent entry and one `agent_sessions` row for the session. | PASS |
| R2-L2 | A23 | See "R2-L2 in detail". | PASS |
| R2-L3 | A25 | See "R2-L3 in detail". | PASS |
| R2-L4 | A24 (live parts) | See "R2-L4 in detail". | PASS |

#### R2-L2 in detail (A23)

1. A first message of 62 characters: "Write one short sentence about why autumn leaves change color."
2. The strip and the sidebar row first showed the first line of the message.
3. 2.0 s after Start session, while the turn still ran, the title strip showed "Why autumn leaves change color". The old sidebar row went away at the same time, and a row with the new title showed.
4. The database had `title` "Why autumn leaves change color" and `title_source` `agent`.
5. The short message "Say hello" (9 characters) also got a title: "Greeting exchange", 0.5 s after its turn ended, with `title_source` `agent`. This is the turn-end path of the adapter that the S10 spec describes.
6. After a quit and a start, the sidebar showed the row "Why autumn leaves change color".
7. Rename: the menu item "Rename" turned the title into a text field with the title selected. The CI test S10-14 covers the save, Escape and a blank title.

#### R2-L3 in detail (A25)

1. Session B started with "Count from 1 to 60 in words, …". The harness then opened the A23 session and set the window focus.
2. While B worked, its row had the description "Working", one running animation, the chat icon in `rgb(238, 238, 241)` (`--text`), and the class `state-working`.
3. At the end of B's turn, B's row had "New answer", the chat icon in `rgb(68, 147, 248)` (`--unread`, #4493f8), and `sessions.unread` = 1.
4. A click on B's row cleared the description, and `sessions.unread` went back to 0.
5. Session C started with "Use the Bash tool to run exactly this command in the current folder: mkdir gamma", in mode Ask. The harness opened the A23 session again.
6. C's row went from "Working" to "Needs your answer": the hand icon (`lucide-hand`, class `state-attention`) in `rgb(210, 153, 34)` (`--attention`, #d29922).
7. With the group `repo-a` collapsed, the group toggle had the description "Needs your answer", and the hand showed at the right of the group row.
8. In C, the card showed "execute · mkdir gamma", "Run this command?", "Yes" and "No". "Yes" ran the command: the folder `gamma` exists. The hand went away, and C went back to the normal icon after the turn.

#### R2-L4 in detail (A24)

- Each group row showed a folder icon and the folder name. The session rows were indented under their group. The group with the newest session was first.
- Hover on a group row showed the chevron and the "+".
- The "+" of the group `repo-a` started four sessions. Each saved `source_path` is `repo-a`, and each row showed under the group `repo-a`. The database kept two folder rows, so no second group appeared.
- The "+" of "Sessions" opened "Start session in" with `repo-a` and `repo-b`, "Add from GitHub" and "Add from URL" disabled with "Coming soon", and "Add local folder or repository".
- A right click on `repo-b` opened "New session" and "Remove folder". "Remove folder" was disabled, with "Delete its sessions first", because `repo-b` has a draft.
- A click on `repo-b` collapsed it. `folders.collapsed` was 1, and after a quit and a start `aria-expanded` was still false.
- Not live: the add of an empty folder needs the native folder picker. CI covers it with S11-15 and S11-24, through the picker stub of S7.

#### Probe against the mockups

The validator compared the live screenshots with the two approved mockups, `s10-session-title.mockup.html` and `s11-sidebar-status.mockup.html`. The row states (Working, New answer, Needs your answer) come from the DOM values in R2-L3: the description, the icon class, the computed color and the running animations. A screenshot shows one frame of the fade only.

| Mockup state | Live | Match |
|---|---|---|
| S10 1: started session, menu closed | Title in the strip, arrow after it, no header row, no trash button | Yes |
| S10 2: menu open | "Rename" (pencil, R), "Fork" and "Archive" disabled with "Coming soon", a separator, "Delete" in red (trash, D) | Yes |
| S10 3: draft, menu open | Title "New session", one red item "Discard draft" | Yes |
| S10 4: long title | Not shown live. The CSS has `overflow: hidden`, `text-overflow: ellipsis` and `white-space: nowrap` on `.session-title`, and the arrow is a separate flex item. | Not probed (CSS read) |
| S11 2: groups and status icons | Folder icons, indented rows, the blue chat icon of "New answer", the yellow hand | Yes |
| S11 3: hover on a group | Chevron down and "+" at the right | Yes |
| S11 4: collapsed group with the hand | Chevron right, the hand at the right. With the keyboard focus on the toggle, the "+" also shows next to the hand, as rule 6 says. | Yes |
| S11 5: no sessions (a profile with no folder) | Not shown live. The sidebar code shows "No sessions yet" when the profile has no folder (`Sidebar.tsx` 179). S11-15 and S11-16 cover an empty folder in a group, not this state. | Not probed |
| S11 6: the "+" menu | Same items, order and disabled states | Yes |
| S11 7: right click on a folder | Same items. "Remove folder" disabled for a folder with a session, with its description. | Yes |

### Review of PR #53

The validator read `git diff 481930d..98d923e`: 12 files, 182 lines added, 20 removed. All 12 files are under `src/`, so no locked test changed.

| Item | What changed | Validator check | Result |
|---|---|---|---|
| M1 | The group "+" is in the row flow, 0 px wide at rest, 26 px on `:hover` and `:focus-within` | The button stays in the focus order (no `display: none`). Live: the "+" showed on hover and with focus, and the hand of a collapsed group stayed visible next to it. S11-2 passed. | No defect |
| L2 | `replaySidebarEvents`: a gap in the replay of the recent events loads the list again | `reload` is `useProfiles.load`, a `useCallback` with no dependencies, so the layout effect does not run at each render. A new list reads the revision of the main process when it reads, and the events come in order. An event that `safeParse` drops is not in the buffer, so the next list covers it. `Transcript.forget` removes the revision only for a deleted session, and the list no longer holds that session. So the reload cannot loop. | No defect |
| L7 | "Start session in" shows only when the profile has a folder | One JSX condition | No defect |
| L8 | `Viewing.checkSeen` logs an error of `onSeen` and does not throw | Unit test added. Covers the focus event and `set-viewing`. | No defect |
| L1 | `folderRowPath`: a new session and an imported draft take the path of the existing folder row of the same folder (on Windows, the case and the kind of slash do not count) | `createSessionHandler` returns only the ID, so no caller holds the old text. Trust and directory checks use `isSameFolder` and `isInsideFolder`, which ignore case on Windows. `folders.add` already used `isSameFolder`. The win32-only tests ran in CI. | No defect. See note N3. |

### Data folder, round 2

- The validator listed the real Aether data folder (303 entries, with sizes and times) before the live runs and after them. The two lists are equal.
- The full acceptance suite checks the same rule (G11), and it passed.
- The live sessions ran in the user's Claude folder, as in round 1. The validator did not change or clean that folder.
- The validator removed its temporary folders. No app or agent process of the runs remained.

### Findings, round 2

No serious finding is open.

| ID | Severity | Status | Finding | Evidence | Suggested route |
|---|---|---|---|---|---|
| F1 | Low | Open, from round 1 | The unit test "version 3 adds the trust answers …" can time out on a loaded CI runner. It did not fail in this round. | `src/building-blocks/migrations.test.ts` 202 has no change since round 1 | As in round 1 |
| F2 | Low | Open, larger | `decisions-to-review.md` has no advisor decisions of S10, S11 or PR #53, in addition to S1 to S4, S6 and S7. The user reads this file at acceptance. | `decisions-to-review.md` has sections for S8, S9 and S5 only; `docs/process.md`, "Escalation" step 5 | Coordinator copies the decisions from PRs #48, #52 and #53 |
| F3 | Low | Open, larger | The brief says 55 agent runs. `user-preferences.md` records 62, then 75. The S11 spec records the user's raise of the cap to 80 ("Add S11 to M1 and raise the cap to 80"). Neither the brief nor `user-preferences.md` has 80. | `brief.md`, "Budget"; `user-preferences.md` line 76; `stories/s11-sidebar-status.md`, "Status" | Coordinator updates both files |
| F4 | Low | New | No acceptance test starts a session from the "+" of a group to the end. S11-4 stops at the composer and checks that no session is created. A24 says "starts a session from a group's '+'". The live run R2-L4 covers it. | `tests/acceptance/m1-chat/s11/groups.spec.ts` 150 | Test author adds the start and the check of the group of the new row, in a later story or a fix PR |
| N1 | Note | Open, from round 1 | The Auto fallback notice cannot show live with today's models. | Round 1, L6 | None now |
| N2 | Note | New | `plan.md` still shows S10, S11 and "Step 7 again for S10 and S11" as not done. | `plan.md` lines 83 to 85 | Coordinator ticks them after this PR |
| N3 | Note | New | PR #53 L1 joins only new sessions to an existing folder row. Folder rows that migration 006 made from sessions whose paths differ only in case stay two groups. The PR says so, and adds no migration. | PR #53 "Notes"; `folders.store.ts` `sessionCount` compares the exact text | None now. A later story can merge such rows if a user meets the case. |

### Role duties that do not apply, round 2

- The m1 plan lists no red PR per gate and no G16 pushes. This run opened no red PR and tried no push.

### Metrics, round 2

| Metric | Value |
|---|---|
| Defects after acceptance | None yet: acceptance is step 8 |
| Rejections | 0 |
| Rework | PR #53: one fix PR after the S11 review (M1, L1, L2, L7, L8) |
| Late finds by round | Step 7 round 1: no product finding. Step 7 round 2: no product finding; F4 is a test gap. |
| Test disputes | No new dispute in round 2 |
| Escalations | The user answers of 2026-11-28 in the S10 and S11 specs (header, menu, Rename, folders, unread, hand) |
| Agent runs against budget | Validator: 2 of 2 in the brief. Milestone total: not in the files. Budget: 55 in the brief, 75 in `user-preferences.md`, 80 in the S11 spec (F3). |
