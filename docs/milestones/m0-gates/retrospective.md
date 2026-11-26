# Milestone m0-gates: retrospective

Step 9 of `docs/process.md`. The coordinator wrote it on 2026-11-26, after the user merged PR #21 (`9a0cd0f`).

## Metrics

The full table is in [metrics.md](metrics.md).

| Measure | Value |
|---|---|
| Agent runs | 39 of 45. The user raised the budget from 35 after run 24. |
| Stories | 8 |
| Review rounds per story | S1 3, S2 2, S3 3, S4 1, S5 4, S6 2, S7 1, S8 1 |
| Stop rule 1 hits | 2: the S5 G10 scan, and the builder guard hook |
| Checks | 16 pass, 4 partial (G8, G16, G17, G21) |
| 1Password prompts | 4 for S8. 22 for the validator, mostly from 11 red PRs. The user accepts the count. |

## What worked

- The test lock held. The `lock` CI job runs the base copy of `check-lock.mjs`, and it caught both red probes.
- Each red probe PR failed the expected job for the expected reason.
- The rulesets refused direct pushes to `main` and `milestone/m0-gates`.
- Worktrees started at the milestone head in every story (G22).
- The coordinator squash merge in auto mode worked once the user added the `autoMode` rule.
- Reviewers found real defects. S3 had zone leaks. S5 had `.skip` escapes. S6 had a lock that a PR could weaken.

## What did not work

1. **The builder guard hook never fired.** It failed in three tries (runs 31, 35 and 38).
   - The hook config is valid for Claude Code 2.1.331.
   - The guard script blocks a real payload when run by hand.
   - Claude Code reports `I:\Whisp` as trusted through `I:/`.
   - The cause is unknown. The `lock` CI job and the reviewer still protect the locked files.
2. **Builder subagents have no advisor tool.** The brief assumed they do. Two probes and the S8 builder confirmed the gap.
3. **The coordinator advisor came late and on the wrong model.**
   - `/advisor fable` took effect only after the S8 merge.
   - That conversation kept Opus 5.5 as the advisor model.
   - The tool was gone after the restart.
4. **Two merges broke the process.**
   - S1 merged as a merge commit.
   - S6 merged before the reviewer verdict.
5. **A builder wrote into the real data folder** in S5. A role rule now forbids it.
6. **A regex scan failed three times** (S5, G10). The swc syntax tree scan fixed it.
7. **The trust state is split.** The CLI wrote the `I:/Whisp` grant to `~/.claude/.claude.json`. The desktop app reads `~/.claude.json`.

## Lessons

- Scan code with a syntax tree, not with a regex.
- Prove each tool assumption before the milestone starts. The hook and the advisor were unproven until the last story.
- Probe a guard with a Sonnet builder. A Haiku builder refuses the attempt, because its role forbids the path.
- Put `Locked-Test-Change:` in the last paragraph of the commit message. Git reads trailers only from that paragraph.
- After the rulesets apply, records land only through PRs.

## Proposed text rules (the user approves each)

1. `docs/process.md`: the builder asks the coordinator when the documents do not settle a choice. The coordinator asks the advisor. Reason: builder subagents have no advisor tool.
2. `docs/process.md`: the user sets the default advisor before the coordinator session starts. Reason: `/advisor` in a running conversation keeps the old model.
3. `docs/process.md`: the user merges a story PR only after a PASS from the reviewer. The user uses a squash merge. Reason: the S1 and S6 deviations.
4. `.claude/agents/builder.md` and `docs/process.md`: do not count the guard hook as a gate until a probe proves it. The `lock` CI job and the reviewer byte check are the gates. Reason: the hook never fired.
5. `docs/process.md`: before a milestone, the coordinator proves each tool assumption in the brief with one cheap probe.

## Follow-ups

- Find why frontmatter hooks do not run for subagents. Ask the user for one `claude --debug` run.
- Extend the guard to `tests/architecture/` and `.claude/settings.local.json`.
- Make `isStoryBase` warn on a base that is not a milestone branch.
- Check that the rulesets allow the push that creates the next `milestone/<id>` branch.
- Fix `host.ts:300-312`, which never shows the exit-code notice on a crash (m1-chat step 6).
- Add a known-violations entry or a rule for the 16 old preload methods (G8).
- Compare the URL origin in the dev-server frame check (`src/main/index.ts:41`).

## Cleanup

- The coordinator removed the m0 agent worktrees. Each had no changes, and each branch is merged or closed.
- The user deletes the leftover probe folder `D:\tmp-probe-ud`.
