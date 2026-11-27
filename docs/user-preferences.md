# User preferences

Status: started on 2026-11-27 from the answers of m0-gates and m1-chat.

The advisor reads this file before each decision. It predicts from it if the user likely disagrees. See "Escalation" in `docs/process.md`.

## How to use this file

- Match a new choice to the patterns below.
- When a pattern matches, predict the same answer.
- When no pattern matches, or two patterns conflict, predict a disagreement and escalate.
- The coordinator adds each new answer and its reason at the end of "Answers".

## Patterns

1. The user accepts a clear recommendation with its trade-offs. In m0 and m1 the user chose the recommendation in all but two of about 60 questions.
2. The user asks for the impact when a question does not give it. Give the impact of each option in one line.
3. The user closes a security or data gap instead of accepting it.
   - Examples: the count in known violations, the base copy of the lock check, trust per profile, the trust question for a folder with hooks or MCP servers.
4. The user keeps the scope small now and extends it later, when a later extension needs no rebuild.
   - Examples: read-only drafts in S2, one account UI in m1, worktrees and projects out of m1.
5. The user prefers rules in code over rules in the database when a database rule needs a table rebuild to change.
   - Example: the check on the provider kind moved to zod.
6. The user protects data that a running or past session depends on.
   - Examples: snapshot of the provider at the first start, lock the Claude folder once used.
7. The user chooses the cost-aware model split: Sonnet builder, Opus for the checks. The user chose this over the recommendation of an Opus builder.
8. The user owns the domain terms. A rename of a domain term goes to the user.
   - Example: Workspace became Profile, and Root became Workspace directory.
9. The user wants less attention during the execution. Settle questions in the design review, not in the middle of a story.

## Answers

| Date | Question | Answer | Reason |
|---|---|---|---|
| 2026-11-26 | Builder model | Sonnet 5.5, checks on Opus 5.5 | Cost, with an advisor for the builder |
| 2026-11-26 | Known violations in a listed file | Add a count | A new violation must not pass |
| 2026-11-26 | Lock check can edit itself | Run the base copy, guard the paths | Close the gap |
| 2026-11-26 | Strict check policy | Keep strict | Safe merges |
| 2026-11-27 | Database check on the provider kind | Drop it, validate in code | No table rebuild for a new provider |
| 2026-11-27 | Claude settings edit for a used account | Snapshot at the first start, lock the folder once used | A resume must not fail |
| 2026-11-27 | Proxy variables in the agent environment | Keep them | Claude needs the proxy |
| 2026-11-27 | Transcript storage | SQLite entries | One store |
| 2026-11-27 | Decision 0011 | Subscription only | Personal use |
| 2026-11-27 | Trust for a plain folder with hooks or MCP servers | Ask | Security |
| 2026-11-27 | Scope of trust answers | Per profile | Profiles separate identities |
| 2026-11-27 | Story specs | A spec and mockups per story, reviewed at the start of the milestone | Less attention during the execution |
| 2026-11-27 | Hard-to-revert choices | Always go to the user | They shape the architecture |
