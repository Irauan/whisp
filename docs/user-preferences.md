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
10. The user follows the patterns of Claude Code, the Claude desktop app and the GitHub app for the chat UI.
    - Examples: a slim composer like the GitHub app, cards inline in the transcript like Claude Code, answered cards like the Claude desktop app.
11. The user wants a clean chat frame. Facts and controls stay out of the header and the dock when the transcript or the composer can hold them.
12. The user corrects a rule that a writer applied too widely. Apply a UI rule only to the case the user named.
    - Example: radio rows apply to AskUserQuestion only; permission cards keep buttons.
13. The user wants each closed question to say why: the answer, or the reason it got no answer.

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
| 2026-11-27 | Process for S5, S8 and S9 | Specs, mockups and design review for these three. S6 and S7 finish on the old path | The specs came late in the milestone |
| 2026-11-27 | Trust for `.claude/settings*.json` and `.mcp.json` | Ask for any of them | Security |
| 2026-11-27 | Workspace directory of two profiles | The most specific directory wins | Separate identities |
| 2026-11-27 | Session header | Title and "Delete session" only. An editable title comes later | A clean frame |
| 2026-11-27 | Composer | Like the GitHub app: 2 to 8 lines, controls inside the box, "+" disabled, no mic | Slim, familiar |
| 2026-11-27 | Model button | Works in a draft, disabled after the first message | The agent fixes the model at the start |
| 2026-11-27 | Transcript scroll | Follow new entries only at the bottom | Keep the reading position |
| 2026-11-27 | Failed turn | One muted line with a "Show log" fold-out | A clean transcript |
| 2026-11-27 | Place of cards | Inline in the transcript, where Claude asked. Not in the dock | Like Claude Code |
| 2026-11-27 | Recommended option | First and primary. On a safety ask, the refuse group is recommended | Safe default |
| 2026-11-27 | Decision cards | Context secondary, question primary. Split buttons group options of one meaning | Few buttons |
| 2026-11-27 | Button size | Content width on one line, else full width stacked | Clean layout |
| 2026-11-27 | AskUserQuestion | Radio rows for one choice, check rows for many, each with an explanation. Nothing preselected | Like Claude desktop |
| 2026-11-27 | Closed cards | Stay in the transcript: question secondary, answer or reason primary. No disabled buttons | A record of each answer |
| 2026-11-27 | Saved entry `answers` | `card` and `outcome` (submitted, skipped, stopped, withdrawn, exited, quit, open, interrupted). Saved at open, replaced at close | A crash leaves a true record |
| 2026-11-27 | "Always" options | Show them, with the labels of Claude | Follow Claude |
| 2026-11-27 | MCP form answers | Save "Answered", not the typed text | Privacy |
| 2026-11-27 | Plan exit and live mode | Show and save the new mode. Never save "Approve all" | The saved mode stays true |
| 2026-11-27 | Refusal fallback | "Keep the refusal" is primary. A retry saves the new model | Safe default |
| 2026-11-27 | Auto fallback | Keep Auto saved | The user chose Auto |
| 2026-11-27 | Trust dialog | Show the repository root path, warn when it holds the workspace directory. Modal in m1 | Security |
| 2026-11-27 | S9 choices | `started_by` in migration 004, constant times, background shells not counted, A21 as a slice test, the child-process fix | The recommendations |
| 2026-11-27 | Run cap of m1 | 62, then 75 | The specs added work |
| 2026-11-27 | Commits when 1Password cannot approve | Commit through `gh` with the Irauan account; GitHub signs | Work continues away from the PC |
| 2026-11-27 | Line above the dock | No line between the transcript and the composer area; the header line stays | A clean frame |
| 2026-11-27 | Cost of ending child processes (S9) | Accept about 0.9 s per close for m1; a faster design later | Correct first |
| 2026-11-27 | Failed list of child processes | Force-kill the agent tree instead of a normal close | Close the security gap |
| 2026-11-27 | Merge of main into the milestone | The coordinator merges the sync PR | Keep the milestone current |
| 2026-11-27 | Acceptance runs of a story | Only the scenarios it touches; the full suite at milestone validation | Faster stories |
| 2026-11-27 | Acceptance test windows | Hide them | No flashing, no stolen focus |
| 2026-11-28 | M2 source of the command list | The agent over ACP only | One source of truth |
| 2026-11-28 | When the agent starts | When a session opens, not on `/` | The agent is ready for the first message too |
| 2026-11-28 | Draft agent on the New session page | On intent, never at launch | No process or trust dialog at each launch |
| 2026-11-28 | A failed start on open | A notice in the transcript | Say why (pattern 13) |
| 2026-11-28 | `/remote-control` in the menu | Hide it | Security |
| 2026-11-28 | `#` menu | None until issues and pull requests are a feature | Only `/` and `@` menus now |
| 2026-11-28 | M2 start | Now, from `milestone/m1-chat` | Speed |
| 2026-11-28 | A file picked with `@` | An inline link in the text, like the Copilot app, not a chip | Follow the Copilot app (pattern 10) |
| 2026-11-28 | A command picked with `/` | A tag at the start of the text; the message text follows it | Follow the Copilot app (pattern 10) |
