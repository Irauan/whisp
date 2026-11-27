# Milestone m1-chat: validation

Status: step 7 of `docs/process.md`, round 1, on 2026-11-27. Validator run 1 of the 2 in the budget.

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
