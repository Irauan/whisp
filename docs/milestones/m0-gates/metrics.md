# Milestone m0-gates: metrics

Source: the coordinator run log, copied by the validator on 2026-11-26 (agent run 39). The coordinator keeps the run log outside the repository, because the rulesets block direct pushes.

## Agent runs against the budget

Budget: 45 agent runs. The user raised it from 35 after run 24.

Used: 39 runs, this validator run included. Left: 6.

| # | Story | Role | Model, effort | Reason | Result |
|---|---|---|---|---|---|
| 1 | S1 | builder | Sonnet 5.5, high | User choice for the builder | PR #1, `b6cac3f` |
| 2 | S1 | reviewer | Opus 5.5, high | User choice for the reviewer | FAIL: 5 serious, 12 nits |
| 3 | S1 | builder, rework 1 | Sonnet 5.5, high | Same builder | `7403c42`, all fixed |
| 4 | S1 | reviewer, re-review | Opus 5.5, high | Same reviewer | FAIL: 2 new serious in the fixed text |
| 5 | S1 | builder, rework 2 | Sonnet 5.5, high | Same builder | `9a462db` |
| 6 | S1 | reviewer, re-review 2 | Opus 5.5, high | Same reviewer | PASS |
| 7 | S2 | builder | Sonnet 5.5, high | User choice for the builder | PR #2, `821e06f` |
| 8 | S2 | reviewer | Opus 5.5, high | User choice for the reviewer | FAIL: zone gaps; per-file list lets new violations pass |
| 9 | S2 | builder, rework 1 | Sonnet 5.5, high | Same builder | `1dedf70`, 70 tests |
| 10 | S2 | reviewer, re-review | Opus 5.5, high | Same reviewer | PASS |
| 11 | S3 | builder | Sonnet 5.5, high | Role file loaded | PR #4, `be42bed` `2a487fb` `02fc522` |
| 12 | S4 | builder | Sonnet 5.5, high | Role file; parallel with S3 | PR #3, `2c1e5c9`, 92 tests |
| 13 | S4 | reviewer | Opus 5.5, high | Role file | PASS. Late find: crash exit notice in `host.ts` |
| 14 | S3 | reviewer | Opus 5.5, high | Role file | FAIL: S-1 type import escapes; S-2 transitive zone leaks |
| 15 | S3 | builder, rework 1 | Sonnet 5.5, high | Same builder | `c62207e` `3d6aed7` |
| 16 | S3 | reviewer, re-review | Opus 5.5, high | Same reviewer | FAIL: S-2 residual (2nd failure of S-2) |
| 17 | S5 | builder | Sonnet 5.5, high | Role file | PR #5. `APPDATA` assumption false |
| 18 | S3 | builder, rework 2 | Sonnet 5.5, high | Same builder | `ff2588d` |
| 19 | S3 | reviewer, re-review 2 | Opus 5.5, high | Same reviewer | PASS |
| 20 | S5 | reviewer | Opus 5.5, high | Role file | FAIL: F1 `.skip` passes lint; F2 snapshot misses writes |
| 21 | S5 | builder, rework 1 | Sonnet 5.5, high | Same builder | `34b2ec4`. Wrote a probe into the real data folder and removed it |
| 22 | S5 | reviewer, re-review | Opus 5.5, high | Same reviewer | FAIL: comment hides `.skip` (2nd failure of F1) |
| 23 | S5 | builder, rework 2 | Sonnet 5.5, high | Same builder | `074040e` |
| 24 | S5 | reviewer, re-review 2 | Opus 5.5, high | Same reviewer | FAIL: regex hides `.skip` (3rd failure). Stop rule 1 |
| 25 | S5 | builder, rework 3 | Sonnet 5.5, high | Same builder; user chose an swc scan | `4bbd021` `bb71874` |
| 26 | S5 | reviewer, re-review 3 | Opus 5.5, high | Same reviewer | PASS |
| 27 | S6 | builder | Sonnet 5.5, high | Role file | PR #6, `3c99edb` `6b9fac2` |
| 28 | S6 | reviewer | Opus 5.5, high | Role file | FAIL: F1 milestone PR always fails lock; F2 PR can weaken its own check |
| 29 | S6 | builder, rework 1 | Sonnet 5.5, high | Same builder | `997928b` |
| 30 | S6 | reviewer, re-review | Opus 5.5, high | Same reviewer | PASS |
| 31 | S7 | builder | Sonnet 5.5, high | Role file; hook probe | PR #7, `a4b6a52` `b48258b`. Hook did not fire |
| 32 | — | hook probe | Haiku 5.5 | Find why the hook did not fire | Refused twice by its role rules |
| 33 | S7 | reviewer | Opus 5.5, high | Role file | PASS |
| 34 | S8 | test author | Opus 5.5, high | Role file; step 3 | `246dacb`, 10 tests fail for the missing feature |
| 35 | S8 | builder | Sonnet 5.5, high | Role file; step 4; advisor call and hook probe | PR #8, `6f7f444`. No advisor tool. Hook did not fire |
| 36 | S8 | reviewer | Opus 5.5, high | Role file; step 5 | PASS in round 1 |
| 37 | — | hook probe | Haiku 5.5 | Cheap probe | Refused by its role rules. No advisor tool |
| 38 | — | hook probe | Sonnet 5.5 | Same probe | Write succeeded (3rd failure of the hook). Stop rule 1. No advisor tool |
| 39 | — | validator | Opus 5.5, high | Step 7 | This report |

Run 11 includes a short resume for a late coordinator note (`02fc522`). The log counts it in run 11.

## Runs and rounds per story

A round is one review verdict.

| Story | Runs | Review rounds | Rework runs | Late finds |
|---|---|---|---|---|
| S1 Roles and rules | 6 | 3 | 2 | 0 |
| S2 CI, typecheck and lint | 4 | 2 | 1 | 0 |
| S3 Architecture tests | 6 | 3 | 2 | 0 |
| S4 Simulated agent | 2 | 1 | 0 | 1, round 1 (crash exit notice in `host.ts`, older code) |
| S5 App test | 8 | 4 | 3 | 0 |
| S6 Test lock | 4 | 2 | 1 | 0 |
| S7 Branch protection | 3 (1 probe) | 1 | 0 | 0 |
| S8 Trial | 5 (2 probes) | 1 | 0 | 0 |
| Validator | 1 | — | — | 0 |
| Total | 39 | 17 | 9 | 1 |

## Metrics of `docs/process.md`

| Metric | Value |
|---|---|
| Defects after acceptance | Not known yet. Acceptance is open. |
| Rejections | 0 so far |
| Rework | 9 builder rework runs |
| Late finds by round | 1: S4, round 1 |
| Test disputes | 0 |
| Escalations to the user | 7, listed below |
| Agent runs against budget | 39 of 45 |

Escalations:

1. S2: known violations carry a `count`.
2. Before S2: the builder may shrink the known violations list, never grow it.
3. S5 stop rule: the G10 scan moves to an swc syntax tree; the tests use `--user-data-dir`; the budget goes to 45.
4. S6: the lock job runs the base copy of the check; the guard blocks gate files; `ci.yml` is an accepted gap; the dispute path uses the trailer.
5. After S7: the strict check policy, and how records land after the rulesets.
6. S8: restart the session, then probe the hook and the advisor again.
7. Hook stop rule: record it and run the validator.

## Stop rule hits

| Item | Failures | Runs | Outcome |
|---|---|---|---|
| G10 scan of the acceptance specs (S5) | 3 | 20, 22, 24 | Stop rule 1. User chose the swc scan. Fixed in run 25. |
| Builder guard hook | 3 | 31, 35, 38 | Stop rule 1. User decision: record and continue. Still open. |

Near misses, 2 failures each: S1 review items (runs 2 and 4), S3 S-2 (runs 14 and 16).

## 1Password prompts

| Phase | Signatures | SSH connections | Total |
|---|---|---|---|
| S8 trial | 2 (test author commit, builder commit) | 2 (two pushes) | 4 |
| Validator, run 39 | 18 | 4 | 22 |

- The S8 merge ran through the GitHub API, so it needed no prompt.
- Validator signatures: 13 commits for 11 red PRs, 2 for the local G15 trailer probe (commit and amend), 2 for the G16 probes, 1 for the evidence PR.
- Validator SSH connections: 1 fetch, 1 push of the red branches, 1 G16 push, 1 push of the evidence branch.
- These counts are requests by the agent. 1Password can show fewer prompts. The user confirms the counts at acceptance.
