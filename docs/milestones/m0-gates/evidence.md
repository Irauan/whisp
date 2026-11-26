# Milestone m0-gates: evidence

Step 7 of `docs/process.md`. The validator wrote this file on 2026-11-26 (agent run 39).

- Brief: `brief.md`. Plan: `plan.md`.
- Milestone head under test: `797ae76` (S8 squash merge). The validator worktree started at `797ae76`.
- Repository: <https://github.com/Irauan/whisp>. A run id `N` links to `/actions/runs/N`. A PR `#N` links to `/pull/N`.
- The plan asks for no live test with Claude. Decision 0011 is open, and this milestone has no Claude behavior.

## Summary

| Check | Verdict |
|---|---|
| G1 | Pass |
| G2 | Pass |
| G3 | Pass |
| G4 | Pass |
| G5 | Pass |
| G6 | Pass |
| G7 | Pass |
| G8 | Partial: see the open item about the old preload methods |
| G9 | Pass, with a wording note |
| G10 | Pass |
| G11 | Pass |
| G12 | Pass |
| G13 | Pass |
| G14 | Pass |
| G15 | Pass |
| G16 | Partial: direct pushes refused; force push not tried, by instruction |
| G17 | Partial: no merge attempt; GitHub reports each red PR as blocked |
| G18 | Pass, with a name deviation for the user |
| G19 | Pass |
| G20 | Pass |
| G21 | Partial: the builder advisor call failed; the other items pass |
| G22 | Pass |

The validator found no serious finding. The open items for the user are in "Open for the user".

## Full regression on `797ae76`

| Gate | CI, run 45874914807 (push) | Local run by the validator |
|---|---|---|
| `typecheck` | success | 4 of 4 zone configs pass |
| `lint` | success | `lint: passed` |
| `unit` | success | 307 tests in 23 files pass |
| `architecture` | success | `architecture: passed` |
| `lock` | success | `lock: passed` against `origin/milestone/m0-gates` |
| `acceptance` | success | 8 of 8 Playwright tests pass |

The PR run of S8 (#8, head `6f7f444`) is run 45873413603. All six jobs pass there too.

## Red PRs

Each red PR is a draft to `milestone/m0-gates`, titled "RED PROBE — do not merge". Each has one commit or one small story. The validator closed each one without a merge and deleted its branch.

| PR | Check | Head | Run | Expected job | Failed jobs | Reason in the log |
|---|---|---|---|---|---|---|
| #9 | G2 | `3757a31` | 45888667252 | typecheck | typecheck, acceptance | `src/main/red-probe.ts(2,14): error TS2322` in `tsconfig.main.json` |
| #10 | G6 | `d4f4db9` | 45888699640 | typecheck | typecheck, acceptance | `src/renderer/src/red-probe.ts(2,24): error TS2503: Cannot find namespace 'NodeJS'` in `tsconfig.renderer.json` |
| #11 | G3 | `14e3d83` | 45888704029 | lint | lint, unit | ``Known violations grew: `typescript(no-floating-promises)` in `src/main/red-probe.ts` `` |
| #12 | G4 | `3d27f62` | 45888709963 | lint | lint, unit | ``Known violations grew: `eslint(no-restricted-globals)` in `src/renderer/src/red-probe.ts` `` |
| #13 | G10 | `595ba87` | 45888715585 | lint | lint, unit | ``Known violations grew: `vitest(no-focused-tests)` in `src/main/red-probe.test.ts` ``; vitest: "Unexpected .only modifier" |
| #14 | G5 | `b076920` | 45888719854 | architecture | architecture, lint, typecheck, unit, acceptance | ``Known violations grew: `renderer-imports-no-main` in `src/renderer/src/red-probe.ts` `` and `renderer-reaches-no-main` |
| #15 | G9 | `b1caa4d` | 45888754275 | lint | lint, unit | ``Known violation is fixed, remove it: `typescript(no-floating-promises) in src/renderer/src/useSuggestions.ts` `` |
| #16 | unit | `65c8868` | 45888759689 | unit | unit | `FAIL src/main/red-probe.test.ts > red probe > fails on purpose`, 1 failed and 307 passed |
| #17 | acceptance | `5fe4a83` | 45888766219 | acceptance | acceptance | G12 test: `getByText('Working', { exact: true })` not found; 1 failed and 7 passed |
| #18 | G14 | `fd37aef` | 45888771140 | lock | lock | ``Locked test changed: `tests/acceptance/m0-gates/red-probe/probe.spec.ts` (commit fd37aef has no Locked-Test-Change trailer with a reason)`` |
| #19 | G15 | `5e8feec` | 45888776653 | lock | lock | ``Locked test changed: `tests/acceptance/m0-gates/s5/app.spec.ts` (commit 5e8feec has no Locked-Test-Change trailer with a reason)`` |

Notes on the extra failed jobs:

- The `acceptance` job runs `npm run build`, and the build runs the typecheck. So a type error also fails `acceptance`.
- `tests/architecture/lint-gate.test.ts` runs the lint gate on the repository. So a new lint finding also fails `unit`.
- The G5 probe also fails `lint` (`no-restricted-imports`) and the renderer typecheck. These are extra layers, not wrong reasons.
- In #18 and #19, the log says "lock: runs the copy of scripts/check-lock.mjs from origin/milestone/m0-gates". So the base copy judged the PR.

## Evidence per check

### G1: one status per gate

- Pass. PR #8 shows six separate checks: `typecheck`, `lint`, `unit`, `architecture`, `lock`, `acceptance`. Run 45873413603, all success.
- The push run 45874914807 on `797ae76` shows the same six jobs, all success.
- Each red PR above shows the six checks as separate statuses.

### G2: type error in `src/main`

- Pass. Red PR #9. The typecheck names `src/main/red-probe.ts` and the line.
- The fixture test "G2: a type error in a main file fails the main config and names the file" passes (`tests/architecture/fixtures.test.ts`).

### G3: floating promise in `src/main`

- Pass. Red PR #11. Lint names the rule and the file. The type-aware rule comes from tsgolint, so tsgolint works with TypeScript 7.

### G4: `localStorage` or `dangerouslySetInnerHTML` in renderer code

- Pass. Red PR #12 shows `localStorage`.
- `dangerouslySetInnerHTML`: a local run on an uncommitted file gave ``Known violations grew: `react(no-danger)` in `src/renderer/src/red-probe-html.tsx` ``. The fixture test "G4: dangerouslySetInnerHTML in renderer code fails lint" passes.
- Known limit, from S2 run 9: oxlint cannot express `document.defaultView.localStorage`.

### G5: renderer imports `src/main`

- Pass. Red PR #14. The architecture gate names the rules `renderer-imports-no-main` and `renderer-reaches-no-main`, and the file.

### G6: Node type in renderer code

- Pass. Red PR #10. The renderer config fails and names the file.

### G7: rule fixtures

- Pass. These tests in `tests/architecture/architecture-gate.test.ts` pass locally and in the `unit` job of run 45874914807:
  - "fails on an import cycle"
  - "fails on a provider that imports a feature"
  - "fails on a slice that imports another slice"
  - "fails on a domain file that imports Node"
- The plan lists no red PR for G7.

### G8: the current code passes

- Pass for the gates: `architecture: passed` and `lint: passed` on `797ae76`. The test "G8: the current code > passes, and each current violation is in the known violations" passes.
- dependency-cruiser with swc parses the TypeScript 7 code. The test "the swc parser > runs" passes.
- `known-violations.json` has two lint entries (3 occurrences) and no import entry.
- Partial: `plan.md` says "The 16 old methods stay as known violations." No gate rule finds them, so the list has no entry for them. `src/preload/index.ts` still exposes 16 old methods, and `src/main/index.ts` has 15 old `ipcMain.handle` channels. `docs/architecture.md` says "The preload exposes only `invoke(name, input)` and `subscribe(name)`." The S8 reviewer (run 36) also noted this.

### G9: the list changes

- Pass. Red PR #15 fixes the listed floating promise and keeps the entry. The gate names the entry and asks to remove it.
- A new violation fails and names the rule and the file: red PRs #11, #12, #13 and #14.
- The tests of "G9: a changed list of violations" in `architecture-gate.test.ts` pass. They cover the import entries: not listed, fixed, growth in a listed file, and a lower count.
- Wording note: the brief says "the architecture test". The lint gate owns the lint entries, and the architecture gate owns the import entries. Today the list holds only lint entries, so the CI proof runs through `lint`.

### G10: `.only` or `.skip` in a test

- Pass. Red PR #13 (`it.only`). Lint fails, and vitest also refuses `.only` in CI.
- The fixture tests pass for `.skip`, and for `.only`, `.skip` and `.fixme` in Playwright specs, parsed with swc.

### G11: "hello" shows "Hello", the real data folder stays untouched

- Pass. The `acceptance` job passes in run 45874914807 and in the local run.
- The fixture starts the app with `--user-data-dir=<temp>`. It compares a snapshot of the real folder before the start and after the exit.
- Local proof: the validator listed each file of the real data folder with its size and time, read only, before and after `npm run acceptance`. The 275 lines are equal.
- The brief assumption "Setting `APPDATA` moves the user data folder" is false. S5 showed it. The tests use `--user-data-dir`.

### G12: "Working" before the gate opens, the reply after it

- Pass. The test "G12: the app shows "Working" while the agent waits at a gate" passes.
- Red PR #17 shows that the test sees a missing "Working" label.
- The test uses no sleep. A search of `tests/acceptance` and `tests/simulated-agent` finds no `waitForTimeout`, `setTimeout` or `setInterval`. A lint fixture proves that a timer in the simulated agent fails lint.
- Slice level (S4): `tests/simulated-agent/*.test.ts` pass in the `unit` job.

### G13: tests first, then code

- Pass. PR #8: `246dacb` adds and locks the tests (only files under `tests/`). `6f7f444` adds the code. The `lock` job passes in run 45873413603.
- The first two commits of the G14 probe also passed the lock check locally, before commit 3.

### G14: a locked test changes after the first code commit

- Pass. Red PR #18 has three commits: lock a new test, add code, change the test and its entry. The `lock` job fails and names the file.

### G15: a test locked on the base branch

- Pass. Without the trailer: red PR #19. The `lock` job fails and names the file.
- With the trailer: local commit `827fba7`, never pushed. The validator ran the base copy of `scripts/check-lock.mjs`, as CI does. Output:
  - ``Locked test change approved: `tests/acceptance/m0-gates/s5/app.spec.ts` in 827fba7: validator probe of G15, a comment line only``
  - `lock: passed`
- The unit test "G15 > passes with the trailer and prints the reason" passes.
- Note: git reads trailers only from the last paragraph of the message. The first local try (`5c55069`) had `Co-Authored-By` in a separate paragraph after the trailer. The check then failed. The gate fails closed, so this is no defect. The test author and the coordinator must put the trailer in the last paragraph.

### G16: direct pushes

- Partial. The validator made two signed empty commits: `8ab5b14` on `main` and `dacbc4c` on `milestone/m0-gates`. One `git push` sent both. GitHub refused both:
  - `GH013: Repository rule violations found for refs/heads/main.` "Changes must be made through a pull request." "6 of 6 required status checks are expected."
  - The same message for `refs/heads/milestone/m0-gates`.
  - `! [remote rejected] ... (push declined due to repository rule violations)`
- After the push, `main` is still `0912869` and `milestone/m0-gates` is still `797ae76`.
- Force push: not tried, by the coordinator's instruction. The API read-back shows the `non_fast_forward` and `deletion` rules on both branches. Both rulesets are active and have no bypass actors.

### G17: no merge with a failed check

- Partial. The validator never merges, so it did not try a merge.
- Both rulesets require the six checks, with the strict policy (rulesets 28178992 and 28178993).
- GitHub reports each of the 11 red PRs as `mergeStateStatus: BLOCKED`. The red PRs are drafts, and a draft is also blocked, so this state alone does not prove the reason.
- The push refusal of G16 shows the same rule: "6 of 6 required status checks are expected."

### G18: the account dialog lists two accounts

- Pass. Both tests of `tests/acceptance/m0-gates/s8/github-accounts.spec.ts` pass with a fake `gh` first on `PATH`. The fake data holds no real account.
- Deviation: the brief names `github.list-accounts`. The plan and the code use `workspaces.list-github-accounts`. Coordinator decision in S8. Open for the user.

### G19: unknown name, invalid input, other frame

- Pass. The four tests of `tests/acceptance/m0-gates/s8/invoke-guard.spec.ts` pass. Each refused call runs no handler.
- `src/app/main/ipc.ts` checks the sender, then the name, then the input, before it runs a controller. `src/app/main/ipc.test.ts` passes.
- The S8 reviewer (run 36) probed a `data:` frame, a `file:` frame and a second window. Each got `forbidden`.

### G20: contract examples

- Pass. The four G20 tests of `tests/architecture/contracts.test.ts` pass. This file is locked for S8.

### G21: the trial story

| Item | Verdict | Evidence |
|---|---|---|
| Test author commit before the builder commit | Pass | `246dacb` (tests and locks), then `6f7f444` (code). Parent of `246dacb` is `35d76ab`. |
| Advisor call from the builder | Fail | Builder subagents have no advisor tool: S8 builder run 35, probes 37 and 38. |
| Reviewer report | Pass | Run 36, PASS in round 1, no serious finding. The report is in the coordinator run log, not on PR #8. |
| Squash merge by the coordinator in auto mode | Pass | `gh pr merge 8 --squash` gave `797ae76`, with the user's `autoMode` rule. |
| Count of 1Password prompts | Recorded | See `metrics.md`. S8 had 4. The user confirms at acceptance. |

- The brief assumption "The advisor works inside a builder subagent" is false.
- The coordinator advisor was on only after the S8 merge. It ran Opus 5.5, not Fable 5.2.
- GitHub shows the same account for every merge. So the merge record cannot tell the coordinator from the user. This is the accepted gap of one account.

### G22: story worktrees start from the milestone head

- Pass. `.claude/settings.json` sets `worktree.baseRef` to `head`. Each worktree started at the milestone head of its time:
  - S3 and S4: `eb73165`
  - S5: `0795a6e`
  - S8: `35d76ab`, the parent of `246dacb`
  - Validator: `797ae76`

## Assumptions of the brief

| Assumption | Result |
|---|---|
| Playwright for Electron runs the built app on `windows-latest`. | True. The `acceptance` job passes. |
| Setting `APPDATA` moves the user data folder of the app. | False. The tests use `--user-data-dir`. |
| dependency-cruiser with swc parses the TypeScript 7 code. | True. G8. |
| tsgolint works with TypeScript 7. | True. G3. |
| `worktree.baseRef: head` starts story worktrees from the milestone branch. | True. G22. |
| Auto mode permits the squash merge to `milestone/*` with the user's rule. | True for S8. Without the rule, auto mode blocked the merge of PR #3 (S4). |
| The advisor works inside a builder subagent. | False. G21. |
| All agents use one GitHub account. | True. Accepted gap. |
| The number of 1Password prompts per story is acceptable to the user. | The user judges at acceptance. See `metrics.md`. |

## Deviations

- S1 merged as a merge commit (`e6ac514`), not a squash.
- The user merged S6 (`7d4a4f9`) before the reviewer verdict. The reviewer then passed it and verified the tree as equal.
- The S5 builder (run 21) wrote a probe file into the real data folder and removed it. Lesson: never write into the real profile. The role files now say this.
- Builder guard hook: it did not fire in three attempts (runs 31, 35 and 38). Stop rule 1 hit. The guard script blocks (exit 2) when run by hand with a real payload. The `lock` CI job still enforces the locked files. User decision: record and continue.
- The S8 builder changed the S3 test `tests/architecture/architecture-gate.test.ts`, which is not locked. It removed the precondition "the current code has no `src/features`", because S8 adds that folder. The assertion that the current code has no import finding stays.

## Open for the user

Do not change these documents alone. The user decides at acceptance.

1. `docs/architecture.md` says `subscribe(name)`. The code has `subscribe(name, callback)`, which returns a stop function. The coordinator accepted it, and its advisor confirmed it after the merge.
2. Brief G18 names `github.list-accounts`. The code names `workspaces.list-github-accounts`.
3. G8: `plan.md` says the 16 old preload methods stay as known violations. No gate finds them, and the list has no entry for them.
4. G16 force push and G17 merge attempt: the evidence is the configuration and the blocked state. The user can ask for a real attempt.

## Nits from the S8 reviewer, still open

- The dev-server prefix check in `src/main/index.ts:41`.
- A dead fixture import.
- `.ui.ts` against `.ui.tsx` in the zone configs.
