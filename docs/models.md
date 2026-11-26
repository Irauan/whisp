# Models

Status: set by the user on 2026-11-26. The section "Models" of `docs/process.md` binds this document.

## Rules

- The test author, the reviewer and the validator rank above the builder.
- When the builder uses the top model, the other roles use a higher effort.
- The coordinator chooses the model and the effort per run. The coordinator may raise or lower them.
- The coordinator records the model, the effort and the reason of each run in `metrics.md` of the milestone.
- The starting session never uses a light model (Haiku).

## Roles

| Role | Model | Effort | Why |
|---|---|---|---|
| Test author | Opus 5.5 | high | A weak test lets a wrong build pass. |
| Builder | Sonnet 5.5 | high | Bounded work with locked tests and an advisor. |
| Reviewer | Opus 5.5 | high | It must find what the builder missed. |
| Validator | Opus 5.5 | high | It judges the whole milestone against the brief. |
| Advisor | Fable 5.2 | not set | Senior engineer for the builder. |

- The role files in `.claude/agents/` set the model and the effort of each role.
- The aliases `opus` and `sonnet` follow the latest version.
- The coordinator records the exact version in the same place.

## Advisor

- Every agent can use the advisor.
- The user turns the advisor on with `/advisor fable` in the coordinator session.
- Subagents inherit the advisor from the coordinator.
- The builder asks the advisor for the middle-column choices of "Decisions" in `docs/process.md`.

## Changing a row

- A change of a row in the table above goes to the user.
- A change for one run follows the rules above.
