# Milestone m0-gates: design and plan

Status: approved by the user on 2026-11-25.

Brief: `brief.md` in this folder.

## Precondition

The user has done the three steps of "Before Milestone 0" in `docs/process.md`. See "User steps" below.

## Architecture change

The baseline in `docs/architecture.md` stays. This milestone adds these items.

### Gates

- `.github/workflows/ci.yml` runs on each PR and each push to `main` and `milestone/*`. It runs on `windows-latest` with Node 24.15 or later.
- CI has one job per gate: `typecheck`, `lint`, `unit`, `architecture`, `lock`, `acceptance`. The rulesets require these names.
- `tsconfig.json` becomes a base. One tsconfig per zone extends it:
  - `tsconfig.main.json`: `src/main`, `src/preload`, `src/app/main`, `src/app/preload`, the main zone files, with Node types.
  - `tsconfig.renderer.json`: `src/renderer`, `src/app/renderer`, `*.ui.tsx`, with DOM types and no Node types.
  - `tsconfig.shared.json`: `src/shared`, `*.contract.ts`, the domain files, with no Node and no DOM types.
- `npm run typecheck` runs all zone configs.
- `.oxlintrc.json` sets the rules for promises, restricted imports, restricted globals (`localStorage`, `sessionStorage`), raw HTML, `.only` and `.skip`. tsgolint gives the type-aware rules.
- `.dependency-cruiser.cjs` uses the swc parser. It holds the rules of "Dependencies" in `docs/architecture.md`, for the current and the target layout.
- `tests/architecture/` holds the vitest tests that run the tools on the fixtures, and the tests for the slice shape, the contract registry and the migrations.
- `tests/architecture/known-violations.json` lists each current violation as `{ rule, file, count }`. One test compares the tool output with the list:
  - An occurrence that is not listed fails.
  - More occurrences than `count` fail.
  - Fewer occurrences than `count` fail until the change lowers `count` or removes the entry.
  - User decision, 2026-11-26: the count closes the gap where a new violation in a listed file passed.
- The list can only shrink. The lock check fails when a PR adds an entry or raises a count.
- Each `src` source file belongs to at least one zone config. A test in `tests/architecture/` checks this.

### Simulated agent

- `tests/simulated-agent/agent.mjs` is a separate ACP program. It replaces `src/main/agents/fixtures/fake-agent.mjs`.
- A test starts a control server on a named pipe and passes the pipe name in `agents.json`, as an argument of the agent. The product reads `agents.json` as it does now.
- On the pipe, the test chooses the scenario and opens gates. The agent reports each ACP message it receives.
- The agent uses no timers. A lint rule forbids `setTimeout` and `setInterval` in `tests/simulated-agent/`.
- Scenarios in this milestone: text, tool with permission, sign-in error, crash, slow start (a gate before `initialize` returns). m1-chat adds plan updates, parallel permissions, the start input report, and the child process that outlives its parent.

### Acceptance tests

- Playwright starts the built app with `_electron.launch`.
- A fixture makes a temporary folder, sets `APPDATA` to it for the app process, and writes `Aether/agents.json` there.
- The fixture for GitHub puts a fake `gh` program first on `PATH`.
- Tests live in `tests/acceptance/<milestone>/<story>/`.

### Test lock

- `tests/locks.json` maps each locked file to its SHA-256 and its story.
- Locked files: `tests/acceptance/**`, and `tests/simulated-agent/**` while a story uses it.
- `scripts/check-lock.mjs` runs in the `lock` job. It walks the commits of the PR, oldest first:
  - The first commit that touches a file outside `tests/` is the first code commit.
  - Before it, a commit can add locked files and their entries.
  - From it on, no commit can change a locked file, its entry, or `known-violations.json` upward.
  - A file locked on the base branch changes only in a commit with the trailer `Locked-Test-Change: <reason>`. The job prints each reason.
- All hashes in `tests/locks.json` must match the files at the head of the PR.

### Roles and settings

- `.claude/agents/test-author.md`, `builder.md`, `reviewer.md`, `validator.md`. Each sets `model`, `effort` and its tools, from `docs/models.md`.
- From S6 on, the builder has deny rules for `tests/acceptance/**`, `tests/simulated-agent/**` and `tests/locks.json`.
- A file is locked when `tests/locks.json` on the base branch has an entry for it, or when the test author added it in the current story. Before S6, no file is locked. S2 to S5 create these paths as normal story work.
- S2 and S3 create `tests/architecture/known-violations.json` with the current violations: S2 for lint, S3 for imports. After S3 merges, the list only shrinks.
- The builder can remove an entry from that list when its change fixes that violation. After S3, the builder never adds an entry. The lock check fails a PR that grows the list. User decision, 2026-11-26.
- The coordinator approves each change of a file locked on the base branch, and only for the test author. The commit then carries the trailer `Locked-Test-Change: <reason>`.
- The coordinator records the model, the effort and the reason of each agent run in `metrics.md` of the milestone.
- The coordinator passes worktree isolation in each builder dispatch. The builder file does not set it.
- The reviewer checks by hand, in every story, that the diff changes no locked file. The deny rules do not cover writes through `Bash`.
- `.claude/settings.json` sets `worktree.baseRef` to `head`.
- `docs/models.md` says when each model and effort fits. The test author, the reviewer and the validator rank above the builder.
- `CLAUDE.md` holds short rules for every session, with links. It stays under 200 lines.

### Branch protection

- `.github/rulesets/main.json` and `.github/rulesets/milestone.json`:
  - PR required.
  - The six CI checks required.
  - Signed commits required.
  - No force push. No deletion.
- `main` allows merge commits only. `milestone/*` allows squash merges only.
- `scripts/apply-rulesets.mjs` applies them with `gh api`. The user approves each run.

### Path step 2: contracts, registry and preload

- `src/building-blocks/result.ts`: the `Result` type.
- `src/building-blocks/contract.ts`: `defineContract(name, input, result, errors, examples)` with zod.
- `src/building-blocks/github.port.ts`: the GitHub port.
- `src/providers/github-cli/`: the port, through `gh`. The code moves from `src/main/github.ts`.
- `src/features/workspaces/list-github-accounts/`: contract, controller, handler, UI hook and test.
- `src/app/contracts.ts`: the registry.
- `src/app/main/ipc.ts`: one `invoke` handler and one `subscribe` handler. It checks the sender frame, finds the name in the registry, validates the input, calls the controller, and logs a defect with a generic message.
- `src/preload/index.ts` adds `invoke(name, input)` and `subscribe(name)`. The 16 old methods stay as known violations. m1-chat removes them.
- The account dialog calls `invoke('workspaces.list-github-accounts', {})`.
- zod is a new dependency (MIT license).

## Stories

S1 to S7 change no product behavior, so they skip step 3. Their fixtures are unit tests from the builder. The reviewer checks each against its checks. S8 changes product code and runs all steps.

| Story | Content | Checks | Depends on |
|---|---|---|---|
| S1 Roles and rules | Role definitions, `docs/models.md`, `CLAUDE.md`, `.claude/settings.json` | G22 | — |
| S2 CI, typecheck and lint | Workflow, zone tsconfigs, oxlint with tsgolint, known violations list for lint | G1 (jobs `typecheck`, `lint`, `unit`), G2, G3, G4, G6, G10 | S1 |
| S3 Architecture tests | dependency-cruiser with swc, fixtures, known violations for imports | G5, G7, G8, G9 | S2 |
| S4 Simulated agent | Program, control pipe, gates, five scenarios. `host.test.ts` moves to it. | G12 (slice level) | S2 |
| S5 App test | Playwright, temporary data folder, `acceptance` job | G1, G11, G12 | S4 |
| S6 Test lock | `locks.json`, `check-lock.mjs`, `lock` job, builder deny rules. Locks the S5 test. | G13, G14, G15 | S5 |
| S7 Branch protection | Rulesets, merge methods, apply script. The user approves the application. | G16, G17 | S6 |
| S8 Trial: contracts and GitHub accounts | Path step 2, as a full story with all gates on. The user is present. | G18, G19, G20, G21 | S3, S7 |

- S1 to S2, then S5, form the walking skeleton: CI runs the real app. The coordinator sends a demo after S5 and continues.
- S3 and S4 are independent after S2. They can run in parallel worktrees.
- S7 needs the final names of the CI jobs, so it waits for S6.

## Check coverage

| Check | Story |
|---|---|
| G1 | S2, S5 |
| G2, G3, G4, G6, G10 | S2 |
| G5, G7, G8, G9 | S3 |
| G11, G12 | S5 (G12 also S4) |
| G13, G14, G15 | S6 |
| G16, G17 | S7 |
| G18, G19, G20, G21 | S8 |
| G22 | S1, proven in S8 |

## Milestone validation (step 7)

- The validator opens one red PR per gate to `milestone/m0-gates`. Each PR breaks one rule: G2 to G6, G9, G10, G14, G15, G17. Each PR must fail for the expected reason. The validator then closes it without a merge.
- The validator tries the pushes of G16 and records the refusals.
- The validator writes `evidence.md` and `metrics.md` in this folder.
- No live check. Decision 0011 is open, and this milestone has no Claude behavior.

## User steps

| Step | Who | State on 2026-11-26 |
|---|---|---|
| Push `14ffcf5` and merge `aether-first-version` to `main` | The user | Done. `main` is at `0912869`. |
| Select the `Irauan` account in `gh` | The user | Done |
| Permit the squash merge to `milestone/*` in the auto mode settings (user settings, not project settings) | The user | Not done. User settings have no `autoMode` key. The first story merge waits for it. |
| Update local Node to 24.15 or later | The user | Done. Local Node is 24.22.3. |
| Turn on the advisor with `/advisor fable` in the coordinator session | The user | Not done. Subagents inherit the advisor from the coordinator. |
| Approve the application of the rulesets in S7 | The user | When S7 runs |
| Be present for the 1Password prompts in S8 | The user | When S8 runs |

## Coordinator questions

The user answered these on 2026-11-26.

| Question | Answer |
|---|---|
| Which checkout do story worktrees start from? | `I:\Whisp` stays on `milestone/m0-gates` for the whole milestone. The coordinator fast-forwards it after each story merge. `worktree.baseRef: head` then gives G22. |
| Which model does each role use? | Builder: Sonnet 5.5, effort high. Test author, reviewer, validator: Opus 5.5, effort high. Advisor: Fable 5.2. `docs/models.md` records this. |

Facts from the Claude Code documents, found by the coordinator:

- A subagent file has no field for deny rules. S6 enforces the builder limits with a `PreToolUse` hook in `builder.md` that blocks `Edit` and `Write` on the locked paths.
- The hook does not cover file writes through `Bash`. The reviewer checks the diff of each story for changes to the locked paths.
- `autoMode` rules are prose. An `allow` entry overrides only `soft_deny`, not `hard_deny`.

## Todo list

- [x] User approves the brief and this plan.
- [ ] User does the steps of "Before Milestone 0". The `autoMode` rule and the advisor remain.
- [x] Coordinator reads the files and lists what it cannot answer. User answers.
- [x] Coordinator creates `milestone/m0-gates` from `main`.
- [x] S1 Roles and rules. PR #1. The user merged it with a merge commit, not a squash.
- [x] S2 CI, typecheck and lint. PR #2, squash merge `3120ca3`.
- [ ] S3 Architecture tests
- [x] S4 Simulated agent. PR #3, squash merge by the user.
- [ ] S5 App test
- [ ] Demo of the walking skeleton to the user
- [ ] S6 Test lock
- [ ] S7 Branch protection
- [ ] S8 Trial: contracts and GitHub accounts
- [ ] Step 7: milestone validation, with one red PR per gate
- [ ] Step 8: user acceptance
- [ ] Step 9: retrospective
