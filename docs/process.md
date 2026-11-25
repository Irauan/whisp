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
| 2 | Design and plan | Starting session and user | Architecture change, stories, todo list | Each check maps to a story, user approves |
| 3 | Acceptance tests | Test author | Locked tests for one story | Tests fail for the expected reason |
| 4 | Build | Builder | Code and unit tests through TDD, story PR | Locked tests and CI pass |
| 5 | Review and story validation | Reviewer | Findings, and evidence for what the story changed | No open serious finding |
| 6 | Story merge | Coordinator session | Story in the milestone branch | CI passes on the milestone branch |
| 7 | Milestone validation | Validator | Full regression, live test with Claude, evidence report | Each brief check has evidence, no open serious finding |
| 8 | Acceptance | User | Accept or reject | User accepts and merges to `main` |
| 9 | Retrospective | Coordinator session | Metrics, lessons, cleanup | User approves new text rules |

- Before step 3, the coordinator reads only the files and lists what it cannot answer. The user answers, and the files are updated.
- Steps 3 to 6 repeat for each story.
- Step 7 runs once, after all stories are merged. It runs again only after a fix.
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

## Roles

Four roles are separate agents. Three work per story, and the validator works per milestone. Each starts with a fresh context and reads files, not the conversation of another role.

- **Test author**: writes and locks the acceptance tests of a story.
- **Builder**: writes unit tests and code. It cannot change a locked test.
- **Reviewer**: reviews the code and validates only what the story changed.
- **Validator**: validates the complete milestone against the brief, as a regression.

A starting session does steps 0 to 2 with the user. A new coordinator session does the rest from the files.

## Decisions

| User | Advisor decides, builder records in the story PR | Builder alone |
|---|---|---|
| Brief, scope, non-goals | Interfaces between modules | Names and structure inside a module |
| Saved data format | New library with a free license | Unit test design |
| Security, permissions, credentials | Error and empty states not in the brief | Fixes of findings within the limits |
| Money and paid services | Visual details that follow existing patterns | |
| Change of an approved decision | | |
| Weaker gate, locked test meaning, or process rule | | |
| Acceptance, merge to `main`, release | | |

- Every agent can use the advisor. The advisor model is Fable.
- For the builder, the advisor is a senior engineer who watches the work of a junior.
- When the documents do not settle a choice in the middle column, the builder asks the advisor. The advisor decides or escalates.
- On escalation, or when the advisor is unavailable, the builder stops with one question. The coordinator gives it to the user. Independent stories continue.
- The other agents send an ambiguity to the coordinator. The coordinator asks the user if the documents do not answer it.

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

## Branches and pull requests

- Each story uses a worktree, a story branch and a PR to `milestone/<id>`.
- The coordinator merges a story PR after CI and the reviewer pass. This merge is a squash.
- Only the user merges a milestone PR to `main`.
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
- `docs/milestones/<id>/`: brief, plan with todo list, evidence, metrics
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
