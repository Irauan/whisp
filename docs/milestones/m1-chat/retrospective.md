# Milestone m1-chat: retrospective

Step 9 of `docs/process.md`. The second m1 coordinator wrote it on 2026-11-28. The user accepted m1-chat on 2026-11-28 ("Accept, I'll merge") and merges PR #57 to `main`.

## Metrics

| Measure | Value |
|---|---|
| Agent runs | 84 of 86. The user raised the cap from 55 to 62, 75, 80 and 86. The first coordinator used 45 runs (S1 to S4, S6, S7). |
| Stories | 11. S10 and S11 were added on 2026-11-28 after the user's hand test. |
| Review rounds per story | S1 1, S2 3, S3 1, S4 4, S5 2, S6 2, S7 3, S8 2, S9 4, S10 2, S11 1 (plus one fix PR, #53) |
| Design reviews | S5, S8, S9 (one run, first coordinator); S10 1 (no serious finding); S11 1 (fail on 3 points, all fixed in the spec) |
| Validation | Round 1 PASS at `f4eb2f2` (A1 to A22). Round 2 PASS at `98d923e` (A1 to A25). |
| Tests at the end | 1167 unit, 142 acceptance (full suite) |
| Defects after acceptance | None known yet |
| Rejections by the user | None. The user changed the scope twice after a hand test (S10, S11) and asked for one fix (PR #46). |
| Locked-test changes | 4 files, each with a `Locked-Test-Change` trailer: S3 `sessions.spec.ts`, S8 `frame.spec.ts` and `frame.ts` (S10), S3 `fixture.ts` (S11). Also the S5 `killApp` fix and the S9 rebuild. |
| Test disputes | 0 |
| Rebuilds after a merge conflict | 6: `sync/m1-main-2`, S9 (#40), hidden windows (#41), S5 (#42), S11 (#52), and the release PR #57 instead of #45 |
| Escalations to the user | S9 cost and failed list; S10 design (header, menu, Open in); S11 design (blue mark, trust question, folders, right-click menu); run cap (4 times) |
| 1Password prompts | 0 in the second half. Commits went through `gh` with the user's account (user decision 2026-11-27). |

## What worked

- **The hand test found what the brief missed.** In one session the user found the composer focus ring, the plain first-line title, the header layout and the sidebar. Each became a spec, a mockup and a design review the same day.
- **Design reviews caught real defects before any code.** The S11 review found that an accessible name with the state would break locked row finders in S3, S4 and S10, that hidden test windows make `isFocused()` always false, and that a failed start never goes through `working`.
- **Commits through `gh`.** `gh-commit.mjs` (GraphQL `createCommitOnBranch`) gave signed commits with no 1Password prompt. Agents used it without a slip.
- **Agents in their own worktrees** (`isolation: worktree`) ran in parallel with no file clash: the S10 builder, the S11 test author and the S11 design review at the same time.
- **Scoped acceptance runs (PR #37)** kept story CI short. The full suite ran only at validation.
- **Live checks on the subscription** in a temporary data folder. The real `%APPDATA%\aether` never changed.

## What did not work

1. **Squash-only merges and stacked branches conflict.** Merge commits are disabled. A branch that holds the commits of an unmerged story (or of `main`) conflicts with the later squash of that story. Six rebuilds came from this, and PR #45 to `main` became unmergeable (`docs/user-preferences.md` had no common base).
2. **A test author could not write into a worktree that it made itself.** It worked in the coordinator worktree and moved the coordinator's untracked files aside for each commit. `gh-commit.mjs` then left the coordinator's branch on a test commit, and the coordinator had to reset it.
3. **The coordinator ran `git switch` to a branch that another worktree held.** The switch failed, and a following `git merge --no-commit` ran on the wrong branch twice. Both were aborted with no damage.
4. **Budget planning.** The cap rose four times. Each new story costs about 5 runs (design review, test author, builder, reviewer, one rework) plus a validator pass.
5. **Spec text that disagreed with itself** reached the test author twice: S10-11 still named "Delete session" after the menu changed, and S11 rule 11 named a "New session" item that rule 12 removed.

## Lessons

- After each squash merge of a story, start the next dependent story from the new milestone head. When a story must build on an unmerged one, plan one rebuild on the milestone after the squash.
- To bring a milestone into `main` (or `main` into a milestone) with squash-only merges, make a branch from the target and commit the source tree on it in one commit. Check `git diff` against the source: it must be empty.
- Give each worktree its own branch on GitHub. Never switch to a branch name that another worktree holds.
- Give every writing agent `isolation: worktree`.
- When the user changes a spec, search the spec for each old name before the test author starts.

## Proposed text rules (the user approves each)

1. `docs/process.md`, step 7: before the validator runs, the coordinator starts the app on the milestone head with a test data folder and asks the user for a hand test. Findings become fix PRs or new stories before validation.
   - Reason: the hand test of 2026-11-27 found 4 changes after a validator PASS (PR #46, S10, S11, and the S10 menu). Validation then had to run twice.
2. `docs/process.md`, "Branches and pull requests": with squash-only merges, a sync between `main` and a milestone is one commit on a branch from the target that holds the source tree. A story that needs an unmerged story waits for its squash, or plans one rebuild.
   - Reason: six rebuilds in m1, and PR #45 could not merge.
3. `docs/process.md`, "Roles": every agent that writes files runs in its own worktree (`isolation: worktree`). Each worktree works on its own branch, which is also on GitHub. A worktree never checks out a branch that another worktree holds.
   - Reason: the S10 test author wrote in the coordinator worktree, and two coordinator merges ran on the wrong branch.
   - The user changed the draft on 2026-11-28: "we can have worktrees as remote branches, not as detached checkouts".

User decision, 2026-11-28: the user approved the three rules, with the change to rule 3 above.

## Follow-ups

- F1: the migrations unit test can time out on a loaded CI runner (5 s limit).
- F2: copy the advisor decisions of S1 to S4, S6, S7, S10, S11 and PR #53 into `decisions-to-review.md`.
- F4: an acceptance test that starts a session from the "+" of a group from start to end.
- N3: folder rows whose paths differ only in letter case stay two groups. A migration can join them.
- S11 low L3: every `sessions.changed` event renders `App` again, also streamed text.
- G-L1 and N1 from validation round 1: parallel shell asks come one after another live; the Auto fallback notice cannot show live with today's models.
- Late finds of the first coordinator (still open): `isExistingFolder` calls `statSync` on a UNC path before the gate; a trailing dot or space in a folder segment; S4 saves streamed text only at the end of a turn.

## Cleanup

- Agent worktrees under `I:\Whisp\.claude\worktrees\agent-*`: each branch is merged or closed. The harness removes the ones with no changes. The user can remove the rest with the app's worktree cleanup.
- Remote branches of m1 (`story/*`, `spec/*`, `fix/*`, `records/*`, `sync/*`, `validate/*`, `release/m1-chat`): no agent deletes a remote branch. The user can delete them after the merge of PR #57.
- The test data folder `%LOCALAPPDATA%\Temp\aether-m1-test` holds the user's hand-test profile. The user deletes it when the hand test ends.
