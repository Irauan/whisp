# Milestone m0-gates: brief

Status: approved by the user on 2026-11-25.

## Outcome

The gates of `docs/process.md` work on the current code. A coordinator session can then run m1-chat without the user's attention between stories.

## Current behavior and gap

- No CI exists. `.github/` has no workflow.
- `npm run typecheck` and `npm test` pass locally: 50 tests in 8 files. No lint and no architecture test exist.
- `main` has no protection. The active `gh` account `Irauan-LettrLabs` can only read the repository.
- `src/main/agents/fixtures/fake-agent.mjs` is a small ACP agent for `host.test.ts`. It has no gates and no scripts that a test controls.
- No test starts the built app.
- No test lock exists.
- No role definitions, no `CLAUDE.md` and no `docs/models.md` exist. `docs/process.md` refers to the last two.
- The preload exposes 17 named methods. The main process has 16 `ipcMain.handle` channels without zod and without a sender check.
- Nobody has tried the story merge in auto mode, the advisor in a subagent, the roles, or the 1Password prompts during a story.

## User experience

This milestone has no new product behavior, except one: the account dialog gets its GitHub accounts through the new contract. The user sees no difference.

The other users of this milestone are the agents and the user as the owner of the process.

### Flows

1. A story PR opens to `milestone/<id>`. CI runs and reports one status per gate.
2. A builder changes a locked test. CI fails and names the file.
3. A change adds a new rule violation. CI fails and names the rule and the file.
4. A change removes a known violation. CI fails until the change also removes the entry from the list.
5. The coordinator merges a green story PR with a squash, in auto mode.
6. A push straight to `main` or to `milestone/*` fails.
7. 1Password asks the user once for each signature and each SSH connection.

### States

| State | What the user or the agent sees |
|---|---|
| CI passes | One green status per gate on the PR |
| CI fails | The failed gate, the rule, and the file |
| Lock broken | "Locked test changed: `<file>`" |
| List grew | "Known violations grew: `<rule>` in `<file>`" |
| Stale entry | "Known violation is fixed, remove it: `<entry>`" |
| Prompt waits | The story waits. Independent stories continue. |

### Visual references

Does not apply. The milestone adds no screen.

## Approach

- The coordinator runs this milestone through `docs/process.md`. Each gate becomes active when its story merges. Later stories then use it.
- Before the test lock exists, the reviewer checks by hand that the builder did not change the acceptance tests.
- The last story is the trial. It is path step 2 (contracts, registry, preload, and the GitHub accounts query). It runs with all gates on, as a normal story. The user is present for the 1Password prompts.
- CI runs on `windows-latest` only, with Node 24.15 or later. The repository is public, so the minutes are free.
- The architecture tests run on the current layout (`src/main`, `src/preload`, `src/renderer`, `src/shared`) and on the target layout (`src/app`, `src/features`, `src/building-blocks`, `src/providers`). A rule for a folder that does not exist yet passes.
- A file `tests/architecture/known-violations.json` lists each current violation by rule and file. CI fails when an entry is added, or when a listed violation no longer occurs.
- Each gate has a fixture that breaks its rule. A test runs the tool on the fixture and expects the failure. Then the gate proves itself in CI.
- The simulated agent replaces `fake-agent.mjs`. It lives in `tests/simulated-agent/`. A test sends commands to it on a local control channel and opens its gates. It uses no timers.
- The acceptance test registers the simulated agent in `agents.json` of a temporary data folder. It starts the app with the Chromium switch `--user-data-dir=<temp folder>`, so the app finds that folder. The product gets no test hook. User decision, 2026-11-26: `APPDATA` does not move the folder, see the assumptions.
- The first acceptance test chats through the current work item panel. Story S1 of m1-chat removes work items, so its test author retires this test.
- The acceptance test of the GitHub accounts query puts a fake `gh` program first on `PATH`. The test uses no real account.
- The test lock: `tests/locks.json` holds the SHA-256 of each locked test file. CI checks the commits of each story PR:
  - The commits before the first code commit can add locked tests and their lock entries.
  - No later commit can change a locked file or its entry.
  - Exception: when the builder disputes a test that the test author added in the same story, the test author changes it in a new commit with the trailer `Locked-Test-Change:`, after the coordinator approves. A change of meaning goes to the user. User decision, 2026-11-26.
  - The lock job runs the copy of `scripts/check-lock.mjs` from the base branch, so a PR cannot weaken the check that judges it. User decision, 2026-11-26.
  - A milestone PR to `main` holds squashed stories. For it, the lock job checks only the hashes and the known violations.
  - A test that is locked on the base branch changes only in a commit with the trailer `Locked-Test-Change:` and a reason. The coordinator adds it only for the test author. It reports each such change in the evidence. A change of meaning goes to the user.
- The builder role has deny rules for `tests/acceptance/**`, `tests/locks.json` and `tests/simulated-agent/**`.
- GitHub rulesets protect `main` and `milestone/*`:
  - A change arrives only through a PR.
  - The required CI checks pass.
  - Commits are signed.
  - No force push and no deletion.
- The rulesets are JSON files in `.github/rulesets/`. The user approves each application to GitHub.
- A story PR merges to `milestone/*` with a squash. A milestone PR merges to `main` with a merge commit, so each story stays one commit on `main`.
- Role definitions live in `.claude/agents/`: test author, builder, reviewer, validator. Each sets its model, its effort and its tools.
- `.claude/settings.json` sets `worktree.baseRef` to `head`. Story worktrees then start from the milestone branch, not from `main`.

### Rejected alternatives

- Required reviews on GitHub. All agents use the user's account, and GitHub does not let an author approve their own PR.
- CODEOWNERS for the locked tests. It depends on reviews, so it has the same problem.
- A throwaway trial story. Path step 2 is real work and tests the same things.
- CI on Linux. Aether runs on Windows 11 only, and Electron tests must run on the target system.
- A test hook in the product to find the simulated agent. Decision 0009 rejects it.
- Squash of a milestone PR to `main`. It removes the story history from `main`.

## Acceptance checks

| ID | Given | When | Then |
|---|---|---|---|
| G1 | A PR to `milestone/m0-gates` with no defect | CI runs | Typecheck, lint, unit, architecture, lock and acceptance pass. Each shows as its own status. |
| G2 | A change with a type error in `src/main` | CI runs | Typecheck fails and names the file. |
| G3 | A floating promise in `src/main` | CI runs | Lint fails. |
| G4 | `localStorage` or `dangerouslySetInnerHTML` in new renderer code | CI runs | Lint fails. |
| G5 | A renderer file that imports from `src/main` | CI runs | The architecture test fails and names the rule. |
| G6 | A renderer file that uses a Node type | CI runs | The renderer typecheck fails. |
| G7 | An import cycle, a provider that imports a feature, a slice that imports another slice, or a domain file that imports Node | The architecture test runs on its fixtures | Each fixture fails with its rule. |
| G8 | The current code | The architecture test runs | It passes. Each current violation is in `known-violations.json`. |
| G9 | A change adds a violation, or fixes one and keeps its entry | CI runs | The architecture test fails and names the entry. |
| G10 | `.only` or `.skip` in a test | CI runs | Lint fails. |
| G11 | The built app, with the simulated agent in `agents.json` of a temporary data folder | The test sends "hello" in the work item panel | "Hello" shows. The real user data folder is not touched. |
| G12 | The simulated agent waits at a gate | The test checks the app, then opens the gate | The app shows "working" before the gate opens and the reply after it. The test uses no sleep. |
| G13 | A story PR: commit 1 adds a locked test, commit 2 adds code | CI runs | The lock check passes. |
| G14 | A commit after the first code commit changes a locked test | CI runs | The lock check fails and names the file. |
| G15 | A change of a test locked on the base branch, without the trailer | CI runs | The lock check fails. With the trailer, it passes and prints the reason. |
| G16 | The rulesets are applied | Somebody pushes straight to `main` or to `milestone/m0-gates`, or force pushes | GitHub refuses the push. |
| G17 | A PR to `milestone/*` with a failed check | The coordinator tries to merge | GitHub refuses the merge. |
| G18 | The renderer calls `invoke('workspaces.list-github-accounts', {})` | A fake `gh` reports two accounts | The account dialog lists both. |
| G19 | The renderer calls `invoke` with an unknown name, with invalid input, or from another frame | The main process receives it | It returns an error and runs no handler. |
| G20 | Each contract in the registry | The contract test runs | Each has valid and invalid examples, and each example gives the expected result. |
| G21 | The trial story | It runs through steps 3 to 6 | The evidence shows: the test author commit before the builder commit, an advisor call from the builder, a reviewer report, a squash merge by the coordinator in auto mode, and the count of 1Password prompts. |
| G22 | A story worktree | The builder starts | Its branch starts from the head of `milestone/m0-gates`. |

## Non-goals

- SQLite, workspaces, sessions, and all of path steps 3 to 6.
- The fix of the seven known defects. The list keeps them until m1-chat.
- Evals at night.
- A live test with real Claude. Decision 0011 is open.
- Coverage limits and mutation tests.
- Packaging and release builds.
- macOS and Linux.

## Constraints

- `docs/process.md` and `docs/architecture.md` bind. Decisions 0001 to 0011 bind.
- Windows 11 only. Node 24.15 or later.
- Tools from decision 0010: dependency-cruiser with swc, one tsconfig per zone, oxlint with tsgolint, vitest.
- Each step leaves a working app.
- Commits are signed through 1Password. AI never bypasses signing.
- AI uses auto mode, never bypass mode.
- The repository is public. Fixtures and evidence hold no real account data and no token.

## Decisions

| Decision | Who | Record |
|---|---|---|
| Gates, roles, branches, test lock as a rule | The user | `docs/process.md` |
| Test layers and simulated agent | The user | `docs/decisions/0009-tests-and-simulated-agent.md` |
| Rule tools | The user | `docs/decisions/0010-rule-tools.md` |
| Milestone 0 before m1-chat, with path step 2 in it | The user, 2026-11-25 | `docs/milestones/m1-chat/brief.md` |
| The trial runs on path step 2 | The user, 2026-11-25 | This brief |
| Test lock design, with the one-account gap accepted | The user, 2026-11-25 | This brief |
| Milestone PRs merge to `main` with a merge commit | The user, 2026-11-25 | This brief |
| S1 to S7 skip step 3. The validator proves each gate with a red PR. | The user, 2026-11-25 | This brief |

## Assumptions and risks

| Item | How the milestone tests it |
|---|---|
| Playwright for Electron runs the built app on `windows-latest`. | G11 in CI. |
| Setting `APPDATA` moves the user data folder of the app. | False. S5 showed that Electron 45.5 on Windows keeps the real folder. `--user-data-dir` moves it. G11 checks that the real folder is not touched. |
| dependency-cruiser with swc parses the current TypeScript 7 code. | G8. |
| tsgolint works with TypeScript 7. | G3. |
| `worktree.baseRef: head` starts story worktrees from the milestone branch. | G22. |
| Auto mode permits the squash merge to `milestone/*` with the user's rule. | G21. |
| The advisor works inside a builder subagent. | G21. |
| All agents use one GitHub account. CI cannot prove who changed a locked test. | See accepted gaps. |
| The number of 1Password prompts per story is acceptable to the user. | G21 counts them. The user judges at acceptance. |

## Accepted gaps

- CI cannot tell the test author from the builder. Reason: one GitHub account for all agents, from `docs/process.md`. The deny rules and the reviewer reduce the risk.
- A PR can still change the `lock` job in `ci.yml`. Reason: a fix needs a `pull_request_target` workflow, and the user chose not to add it now. The reviewer checks each change under `.github/workflows/`. User decision, 2026-11-26.
- Before the lock story merges, only the reviewer guards the tests. Reason: the lock is built in this milestone, and S1 to S5 add no locked acceptance test of product behavior.

## Budget

45 agent runs. The user raised it from 35 on 2026-11-26, after 24 runs.

- 7 gate stories skip step 3, at about 3 runs each: 21.
- The trial story, with all steps: 5.
- Validator: 2.
- Rework: 7.
