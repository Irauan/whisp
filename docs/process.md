# Aether development process

Status: approved by the user on 2026-11-25.

Principle: automated evidence replaces the user's attention. The user owns the start and the end of each milestone.

## Terms

- **Milestone**: one outcome that the user accepts as a whole. One PR carries it to `main`.
- **Epic**: a capability. It can span milestones.
- **Story**: a vertical slice with behavior that a person can see. It follows INVEST. One PR carries it to the milestone branch.
- **Task**: one line of the plan of a story.
- **Serious finding**: a failed acceptance check, a bug, a security problem, data loss, a broken architecture rule, or an unrecorded decision. It needs a reproduction or a cited line.
- **Agent run**: one dispatch of a test author, a builder, a reviewer or a validator.

## Steps

| # | Step | Who | Output | Evidence to continue |
|---|---|---|---|---|
| 0 | Architecture baseline, when none exists | Starting session and user | `architecture.md`, decision records | User approves |
| 1 | Brief | Starting session and user | Brief contract | All sections filled, each check testable, user approves |
| 2 | Design and plan | Starting session and user | Architecture change, stories, one spec per story, todo list | Each check maps to a story, each story has a spec, user approves the design review |
| 3 | Acceptance tests | Test author | Locked tests for one story | Tests fail for the expected reason |
| 4 | Build | Builder | Code and unit tests through TDD, story PR | Locked tests and CI pass |
| 5 | Review and story validation | Reviewer | Findings, and evidence for what the story changed | No open serious finding |
| 6 | Story merge | Coordinator session | Story in the milestone branch | CI passes on the milestone branch |
| 7 | Milestone validation | Validator | Full regression with the full acceptance suite, live test with Claude, evidence report | Each brief check has evidence, no open serious finding |
| 8 | Acceptance | User | Accept or reject | User accepts and merges to `main` |
| 9 | Retrospective | Coordinator session | Metrics, lessons, cleanup | User approves new text rules |

- Before step 3, the coordinator reads only the files and lists what it cannot answer. The user answers, and the files are updated.
- Steps 3 to 6 repeat for each story. Independent stories run them in parallel. See "Parallel work".
- Before step 7, the coordinator starts the app on the milestone head with a test data folder and asks the user for a hand test. Each finding becomes a fix PR or a new story before step 7. User decision, 2026-11-28 (m1 retrospective).
- Step 7 runs once, after all stories are merged. It runs again only after a fix.
- A story runs only the acceptance scenarios that it touches. The full acceptance suite runs only in step 7, on a PR to `main` and on `main`. User decision, 2026-11-27.
- Step 7 turns each regression into a finding. The coordinator fixes it with a fix PR to the milestone branch. Step 7 then runs again.
- The first stories form a walking skeleton. The coordinator then sends a demo and continues without waiting.
- A story that changes no behavior can skip step 3.
- A rejection becomes a failing check and a new story. A second rejection for the same reason returns to the brief.

## Brief

AI is a partner, not an interviewer.

1. It studies the code, the documents and past decisions first.
2. It fills the gaps and recommends one approach with its trade-offs.
3. Each turn, it recomputes the open points. It raises all points that do not depend on another open point.
4. It raises points that affect each other as one point.
5. It judges the user's reasoning, challenges it, and completes it.

The contract has these sections:

- outcome
- current behavior and gap
- user experience: flows, states and visual references
- approach: direction and rejected alternatives
- acceptance checks: concrete examples, each testable
- non-goals
- constraints
- decisions: who decided, with a link to the record
- assumptions and risks: each with how the milestone tests it
- accepted gaps: each with the user's reason
- budget: the limit in agent runs

A section that does not apply says why.

## Story specs and design review

Goal: settle the choices that the user would question before the execution starts. During the execution, the user's attention is the exception.

### Story spec

Step 2 writes one spec for each story in `docs/milestones/<id>/stories/<story>.md`. The spec has these sections:

- behavior: flows, states and the checks of the story
- screens: a mockup of each screen and state that the story adds or changes
- data: tables, columns, constraints, migrations and other saved formats
- interfaces: contracts, ports, IPC names and events
- terms: the names in the UI, the code and the database
- error and empty states
- files and dependencies: the areas the story touches, and the stories it needs
- open choices: each with options, a recommendation, the impact of each option, and if it is hard to revert

A section that does not apply says why.

### Mockups

- Show each screen change as a mockup, not as text.
- Write each mockup as one static HTML file: `docs/milestones/<id>/stories/<story>.mockup.html`.
- Use the colors, fonts and components of the app. Use fake data.
- Show each state of the screen: empty, loading, error and filled.
- Mark each change against the current screen.
- The user opens the mockup, comments on it or edits it. The spec then follows the mockup.
- The approved mockup is the visual reference for the test author and the builder.

### Design review

1. The starting session writes the specs from the code, the documents, the decisions and `docs/user-preferences.md`.
2. One reviewer run checks the specs against the code, the architecture and the decision records. It reports conflicts, false assumptions and checks that no spec covers.
3. Each agent run asks the advisor about each open choice. The advisor answers as in "Escalation".
4. The starting session shows the user the mockups and the hot items:
   - each item of the user column of "Decisions"
   - each choice that is hard to revert
   - each choice where the advisor predicts that the user likely disagrees
5. The other choices appear in one list. The user can skim it and veto an item.
6. The user approves the design review. The specs are then the contract for the test author, the builder and the reviewer.

### After the design review

- A choice inside an approved spec follows "Escalation". It does not need a new user approval.
- A user approves a saved format once, in the design review. A later change that only adds to it follows "Escalation".
- A change that removes or changes an approved hot item goes to the user.

## Roles

Four roles are separate agents. Three work per story, and the validator works per milestone. Each starts with a fresh context and reads files, not the conversation of another role.

- **Test author**: writes and locks the acceptance tests of a story.
- **Builder**: writes unit tests and code. It cannot change a locked test.
- **Reviewer**: reviews the code and validates only what the story changed.
- **Validator**: validates the complete milestone against the brief, as a regression.

A starting session does steps 0 to 2 with the user. A new coordinator session does the rest from the files.

Every agent that writes files runs in its own worktree. Each worktree works on its own branch, which is also on GitHub. A worktree never checks out a branch that another worktree holds. User decision, 2026-11-28 (m1 retrospective).

## Decisions

| User | Advisor decides, the agent records it in the story PR | Agent alone |
|---|---|---|
| Brief, scope, non-goals | Interfaces between modules | Names and structure inside a module |
| Saved data format, in the design review | Additions to an approved saved format | Unit test design |
| Security, permissions, credentials | New library with a free license | Fixes of findings within the limits |
| Money and paid services | Error and empty states not in the spec | |
| Change of an approved decision | Visual details that follow existing patterns or an approved mockup | |
| A choice that is hard to revert | Other choices inside an approved spec | |
| A change of an approved hot item | | |
| Weaker gate, locked test meaning, or process rule | | |
| Acceptance, merge to `main`, release | | |

A choice is hard to revert when its undo needs one of these:

- a migration of saved user data
- a change in several modules
- a change of an approved decision or an approved hot item

### Advisor

- Every agent can use the advisor. The advisor model is Fable.
- For the builder, the advisor is a senior engineer who watches the work of a junior.
- The user sets Fable as the default advisor before the coordinator session starts. `/advisor` in a running conversation keeps the old model.
- The coordinator checks for the advisor tool as its first action. When the tool is missing, it stops and asks the user to start it.
- No story starts without the advisor.

### Escalation

The advisor answers each question first. The user gets only the questions that need the user.

1. The agent asks the advisor. It gives the choice, the options, its recommendation and the files that apply.
2. The advisor reads `docs/user-preferences.md` and the story spec. It answers with:
   - its decision and the reason
   - if the choice is hard to revert
   - if the user likely disagrees, and why
3. The agent escalates to the coordinator in each of these cases:
   - the item is in the user column
   - the choice is hard to revert
   - the advisor predicts that the user likely disagrees
   - the advisor is unavailable
4. Otherwise the agent applies the decision and records it in the story PR, under "Advisor decisions".
5. The coordinator copies the advisor decisions of each merged story to `docs/milestones/<id>/decisions-to-review.md`.
6. The user reads that list at the demo and at acceptance. A veto becomes a failing check and a new story.

A question to the user follows these rules:

- The coordinator sends together all the questions that wait.
- Each question gives the options, the advisor recommendation, and the impact of each option in one line.
- While a question waits, its story waits. Independent stories continue.
- The coordinator records each answer and its reason in `docs/user-preferences.md`.

## Locked tests

- CI fails when a story changes a locked test without the approval below.
- The builder can dispute a locked test. Only the test author can change it.
- A change of meaning goes to the user.

## Stop rules

Stop an item and tell the user after any of these:

1. Three failures of the same item. A finding that returns is the same item.
2. Three consecutive rounds that each add more errors than they remove.
3. The milestone budget, in agent runs.

A new finding in code that a fix touched counts against that fix. A new finding in other code is a late find. It does not stop the loop, and its round is recorded.

## Models

- `docs/models.md` describes when each model and effort fits. The coordinator chooses per run and records the reason.
- The test author, the reviewer and the validator rank above the builder. At the top rank, they use a higher effort.
- The starting session never uses a light model.

## Gates

Milestone 0 builds the gates before unattended work:

- CI with typecheck, lint, unit tests and architecture tests
- an automated test of the real app, with a simulated agent
- the test lock
- protection of `main` and the milestone branches
- a trial of the story merge, the advisor, the roles and the 1Password prompts in Claude Code

CI is fast and deterministic. Evals test judgment at night, only when something changed.

The acceptance scope:

- On a story PR, CI runs the spec folders that the PR touches and the folder of its story branch. `scripts/acceptance-scope.mjs` picks them.
- On a push to a milestone branch, CI runs the spec folders that the push touches.
- On a PR to `main`, a push to `main` and a manual run, CI runs the full suite.
- Typecheck, lint, architecture, unit tests and the lock check run in full on each PR.

Before a milestone, the coordinator proves each tool assumption of the brief with one cheap probe.

## Parallel work

The coordinator runs each step that does not wait for another step at the same time.

- The plan lists, for each story, the stories it needs and the areas it touches. The spec gives the same facts.
- The coordinator starts each story when the stories it needs are merged.
- Each story runs in its own worktree. At most three stories build at the same time.
- The test author of a story can run while a builder works on another story. Its tests must not need unmerged code.
- The reviewer of one story can run while a builder works on another story.
- Stories that touch the same areas merge one at a time. The later story updates its branch and runs CI again.
- A question or a 1Password prompt that blocks one story does not stop the other stories.

## Branches and pull requests

- Each story uses a worktree, a story branch and a PR to `milestone/<id>`.
- The coordinator merges a story PR after CI and the reviewer pass. This merge is a squash.
- Only the user merges a milestone PR to `main`.
- Merges are squashes only. So a sync between `main` and a milestone is one commit on a branch made from the target, which holds the tree of the source. `git diff` against the source must be empty. A story that needs an unmerged story waits for its squash merge, or plans one rebuild on the milestone after it. User decision, 2026-11-28 (m1 retrospective).
- A timer never merges.
- AI uses the GitHub account and the SSH key of the user. 1Password asks the user to approve each signature and SSH connection, as it does now.
- Each story needs at least two commits: the locked tests, then the code.
- When nobody approves a prompt, the story waits. Independent stories continue in their own worktrees.
- AI does not change the signing settings or use an unsigned commit to avoid a prompt.
- AI uses auto mode, never bypass mode.

## Memory

- `docs/process.md`: this process
- `docs/models.md`: model guidance
- `docs/architecture.md`: current architecture
- `docs/decisions/`: one record per decision
- `docs/milestones/<id>/`: brief, plan with todo list, evidence, metrics, decisions to review
- `docs/milestones/<id>/stories/`: one spec per story, and its mockups
- `docs/user-preferences.md`: the past answers of the user and their reasons, for the advisor
- `CLAUDE.md`: short rules for every session, with links

All state is in files. The repository is public, so these files are public.

## Learning

1. Turn a failure into a test, type or lint rule. AI adds it alone.
2. Otherwise propose a text rule after two independent cases share a cause. Replay a past case with and without the rule.
3. Show the user at most three text rules per milestone.
4. Remove a text rule after two milestones without evidence of use.

Review this section after three milestones.

## Autonomy and metrics

The user accepts each milestone. After three clean milestones, the user decides if low-risk milestones can have later acceptance. A defect after acceptance moves this back.

Metrics per milestone: defects after acceptance, rejections, rework, late finds by round, test disputes, escalations, agent runs against budget.

## Before Milestone 0

1. The user merges `aether-first-version` to `main`.
2. The user selects the `Irauan` account in `gh`.
3. The user permits the story merge to `milestone/*` in the auto mode settings.

## Open points

None.
