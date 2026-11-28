# Milestone m2-slash-menu: brief

Status: approved by the user on 2026-11-28. Changed by the design review on 2026-11-28 (user answers recorded in the Decisions table); the user approved the change with the design review on 2026-11-28.

## Outcome

The user types `/` in the composer of a session. A menu lists every command that Claude Code offers for the profile and the folder of that session: skills, plugin skills and commands, built-in commands and MCP prompts. The user picks one and sends it.

The user types `@` in either composer. A menu lists the files of the session folder, like the GitHub Copilot app. The user picks a file, and the agent gets it with the message.

## Current behavior and gap

- The composer has mentions (`@` and `#`, `src/renderer/src/mention.ts`). It has no `/` menu.
- The adapter `claude-agent-acp` 0.112 sends `available_commands_update` after each session start. Aether drops it: `src/providers/acp/acp-agents.ts` handles no such update.
- The user can type `/review` by hand. Claude runs it, but the user cannot see which commands exist.
- The agent process starts only at the first message (m1-chat). Before that, no command list exists. M1 listed the early start as a non-goal.
- The Customize page shows "coming soon". Decision 0008 keeps the shared library for later.
- `@` works only on the "New session" page. The reply composer has no `@`.
- `@` works only in a Git repository. A plain folder shows "The folder is not a Git repository."
- The `@` list shows all folders first, then the files. It has no file icons and shows at most 20 rows.
- The list comes from the old IPC handler `repository:files` in `src/main/index.ts`. It is not a contract slice.
- An attachment reaches the agent only with the first message (decision 0012, "Readings in story S7").

## User experience

### Flows

1. Running session. The user types `/` at the start of the composer text. The menu opens and lists the commands of the session. The user types more letters, and the menu filters. Enter or Tab puts the command at the start of the text as a tag: a pill with an icon and the name. The user types the rest of the message after it and sends. Claude gets `/<name> <rest>`. User decision, 2026-11-28: a tag, then the text.
2. Opened session. The user opens a session that has no agent process, for example after a restart of Aether. Aether starts the agent and resumes the session at once. The menu works before the next message.
3. New session. On the "New session" page, the user clicks or types in the composer, or changes the folder or the profile. Aether then starts an agent for that draft. A launch of Aether starts no agent. The menu works before the first message. Send uses that same agent.
4. Untrusted repository. In flows 2 and 3, the trust question of m1-chat shows before the agent starts. Cancel starts no agent. A notice in the transcript says why (user decision, 2026-11-28).
5. File mention. The user types `@` in the "New session" composer or in the reply composer. The file menu lists the files of the session folder. The user types part of a name, and the menu filters. Enter puts the file in the text as an inline link: its icon and name in the link color, with the path as a tooltip. Send gives the agent the text with `@<path>` and a resource link for the file, with that message. User decision, 2026-11-28: a link, not a chip.

### File menu

The second reference screenshot of the user (2026-11-28) shows it: the files of the repository, one row each, with an icon for the file type.

| Part | Content |
|---|---|
| Position, selection, keys, mouse, scroll | The same as the slash menu. Both menus use one component. |
| Row | The icon of the file type, then the path from the folder root. |
| Icons | Markdown, JSON, YAML, code and plain text have their own icon. Other files get the plain file icon. |
| Order without text | Paths in sorted order, as Git lists them. Dot folders come first, as in the screenshot. |
| Filter | Files whose name starts with the text come first, then names that contain it, then paths that contain it. |
| Folders | A folder shows only when the text matches its path. It comes after the files. |
| Source | In a Git repository: the tracked and the untracked files that `.gitignore` does not exclude. In a plain folder: a walk of the folder that skips `.git` and `node_modules`. |

| State | What the user sees |
|---|---|
| Loading | "Loading files…" with a spinner |
| No match | "No file matches @<text>." |
| Empty folder | "This folder has no files." |
| More than 100 matches | 100 rows. The last row says "Type more to narrow the list." |
| More than 50,000 files | Aether reads the first 50,000. A muted line says so. |
| No folder | "Choose a folder first." (as now) |

### Menu

| Part | Content |
|---|---|
| Position | Above the composer box, full width of the box, like the reference screenshot |
| Row | The command name in bold with its `/`, then the one-line description in muted text. The argument hint follows the name, when the command has one. |
| Selection | The first row is selected. The selected row has the highlight color and a left accent bar. |
| Keys | Up and Down move the selection. Enter and Tab insert. Escape closes and keeps the text. |
| Mouse | Hover selects. A click inserts. |
| Scroll | At most 9 rows show. The list scrolls and keeps the selected row in view. |
| Filter | The text after `/` filters by name. Names that start with the text come first, then names that contain it. |
| Order | The order of the agent inside each filter group |

### States

| State | What the user sees |
|---|---|
| Loading | The agent has not sent its list yet. The menu shows "Loading commands…" with a spinner. If Aether has a last list for the same Claude account and folder, the menu shows it at once, and the agent list replaces it. |
| Filled | The rows. |
| No match | "No command matches /<text>." |
| Empty | The agent sent an empty list. "Claude Code offers no commands here." |
| No agent | Trust refused, sign-in missing or agent stopped. The last list of the same account and folder, or "Commands show when Claude Code runs." The notice in the transcript gives the reason. |
| Closed | `/` is not at the start of the text, or the user pressed Escape. |

### Visual references

- The screenshot that the user gave on 2026-11-28: a slash menu above a composer, bold name, muted description, highlighted selected row, scroll bar.
- The mention menu of the current composer and the design tokens in `src/renderer/src/styles.css`.
- Each story spec has a mockup (`docs/process.md`, "Mockups").

## Approach

- The agent is the only source of the list. Aether does not read the Claude folder or the session folder on disk for commands. Claude Code applies its own rules: plugin settings, project skills, MCP prompts, and commands that do not work over ACP.
- The agent port gets one neutral update `commands`: a list of name, description and argument hint. `providers/acp` translates `available_commands_update` into it.
- The main process keeps the latest list of each session in memory. It also keeps the last list for each Claude account and folder, in memory only, to fill the menu while an agent starts. No migration.
- A query returns the list of a session. An event carries each change, with a revision, as `docs/architecture.md` says.
- A selected command is plain text in the message. Claude Code runs it. Aether runs no command itself.
- `/remote-control` is not in the menu (user decision, 2026-11-28). It lets claude.ai or the Claude mobile app drive the session.
- The agent starts when the user opens a session, not at the first message. User decision, 2026-11-28: "I would start the agent when we open the session and not on /."
  - An opened session that has no process resumes at once, after the trust and directory questions.
  - The "New session" page starts an agent for the draft on intent: a click or key in its composer, or a change of folder or profile. Never at launch (user decision, 2026-11-28). Send uses it, applies the model and the mode, and then sends the prompt.
  - If the folder, the profile or the Claude account of the draft changes, Aether closes that agent and starts a new one.
  - If an attachment adds a directory outside the folder, Aether starts a new agent at Send with the full list of directories. `session/new` takes the directories only at the start.
  - When the user leaves the "New session" page without Send, Aether closes the draft agent.
  - Each early agent counts for the idle limit and the release time of decision 0006.
- Decision 0006 allows a start "when the user starts to type". A start when the session opens goes further. A new decision 0015 records it. The builder of S2 writes it from this brief.
- Decision 0008 does not change. M2 lists the isolated items through the agent and builds no shared library.
- The file list becomes a contract slice: `repositories.list-files`. It replaces the IPC handler `repository:files`. The main process reads the folder of the session, never a path from the renderer.
- `@` in the reply composer adds a resource link to that turn. This extends the reading of decision 0012 that sends links only with the first turn. The `#` menu goes away until issues and pull requests are a feature (user decision, 2026-11-28).

### Rejected alternatives

- Read the Claude folder and the session folder on disk. Aether would copy the loading rules of Claude Code, and they change. Built-in commands and MCP prompts need a running Claude anyway.
- Disk read for a fast first list, then the agent list. Two sources can disagree, and the menu would change under the user.
- Start the agent when the user types `/`. The user prefers the start when the session opens: the agent is then ready for the first message too.
- No early start: the menu works only after the first message. The menu is most useful before the first message.
- Skills only in the menu. The plain ACP list does not mark which items are skills. The user chose the full list.

## Acceptance checks

Each check runs with the simulated agent in CI. Checks marked "live" also run with real Claude in step 7.

| ID | Given | When | Then |
|---|---|---|---|
| B1 | A running session. The agent lists `review` (hint `[pr]`), `compact`, `mcp:github:pr` and `mcp`, each with a description. | The user types `/` as the first character | The menu shows the 4 rows in the agent order, each with the bold name, the hint and the description. The first row is selected. (live: the list holds `/mcp` and the skills of the profile) |
| B2 | B1 | The user types `/co`, presses Down and Enter, types `now`, and sends | The tag `compact` is at the start of the text, and `now` follows it. The agent receives the prompt `/compact now`. The transcript shows the same tag. (live: `/mcp` sends, and Claude answers with the MCP server status) |
| B3 | B1 | The user types `hello /` | No menu opens. |
| B4 | The menu is open with the text `/re` | The user presses Escape | The menu closes. The text stays `/re`. |
| B5 | A session whose agent sends 30 commands | The user opens the menu and presses Down 12 times | At most 9 rows show. The selected row is in view. Hover selects a row, and a click inserts it. |
| B6 | B1 is open | The agent sends a new `available_commands_update` with `deploy` added | The open menu shows `deploy` without a reopen. |
| B7 | The agent has not sent a list yet, and no last list exists | The user types `/` | "Loading commands…" shows. When the list comes, the rows replace it. A filter that matches nothing shows "No command matches /<text>." |
| B8 | Profile A and profile B with different Claude folders. The simulated agent lists `skill-a` under A and `skill-b` under B. | The user opens the menu in a session of each profile | A shows only `skill-a`. B shows only `skill-b`. (live: a project skill `aether-probe` in `.claude/skills` of a temporary repository shows in the menu and runs) |
| B9 | A session with two turns, after a restart of Aether | The user opens the session and sends nothing | The agent process starts and resumes the same agent session. The menu lists the commands. (live) |
| B10 | A session in an untrusted repository, after a restart | The user opens the session | The trust question shows. No agent process exists before the answer. Cancel starts no process. The notice "Aether did not start the agent in this repository." shows, and the menu shows "Commands show when Claude Code runs." |
| B11 | The "New session" page with a profile and a trusted folder | The user types `/` and then sends "Say hello" | The menu lists the commands before the first message. The agent receives one `session/new` only. The prompt goes to that agent session. (live) |
| B12 | The "New session" page with a draft agent running | The user changes the folder, then leaves the page | The first agent closes when the folder changes, and a new one starts. The second closes when the user leaves. No agent process of the draft stays. |
| B13 | The "New session" page with a draft agent running | The user attaches a folder outside the session folder and sends | A new agent starts with that folder as an additional directory, after the directory question. The first one closes. |
| B14 | 8 sessions without a process | The user opens them one after the other | At most 6 idle processes stay open. The oldest idle one closes first. (Regression of A22.) |
| B15 | The "New session" page with a repository that holds `.claude/agents/builder.md`, `.github/workflows/ci.yml`, `package.json` and `src/app.ts` | The user types `@` | The file menu shows the 4 files in this order, each with its type icon. No folder row shows. The first row is selected. |
| B16 | B15 | The user types `@app` | `src/app.ts` shows first. Typing `@src` shows the files under `src/`, then the folder row `src/`. |
| B17 | A running session in the B15 repository | The user types `@ci`, presses Enter, types "Check this", and sends | `ci.yml` shows as an inline link in the text, with the path as a tooltip. The agent receives `@.github/workflows/ci.yml Check this` and a resource link for that file with this turn. The transcript shows the same link after a restart. (live) |
| B18 | A plain folder (no Git) with `notes.md`, `node_modules/x/index.js` and `.git/config` | The user types `@` | The menu lists `notes.md` only. |
| B19 | A repository with more than 100 files that match | The user types `@` | The menu shows 100 rows and the row "Type more to narrow the list." A slice test checks the limit of 50,000 files. Changed after the design review: a timing check is not deterministic. |

## Non-goals

- Commands that Aether runs itself, such as `/fork`, `/rename` or `/clear` of the reference screenshot.
- A list or an editor of skills, plugins and MCP servers on the Customize page. It stays "coming soon".
- The shared library of decision 0008.
- Install, enable or disable of skills, plugins or MCP servers. The user does it in Claude Code. `/mcp` in the menu shows the status.
- A command in the middle of the text. Claude Code reads a command only at the start of the message.
- Completion of command arguments.
- A tag for the kind of each row (skill, plugin, MCP prompt, built-in). The plain ACP list does not give it. See "Accepted gaps".
- Agents other than Claude Code.
- A search in the content of files, or a list of symbols.
- A `#` menu. Aether removes it until issues and pull requests are a feature. User decision, 2026-11-28: "At this point we should have only the menu for / and @".
- A live update of the file list while the menu is open. Each new `@` reads the folder again.

## Constraints

- `docs/process.md` and `docs/architecture.md` bind. Decisions 0001 to 0014 bind.
- M2 starts now from `milestone/m1-chat`. User decision, 2026-11-28. The M2 milestone PR to `main` waits until the user merges M1.
- The coordinator merges `milestone/m1-chat` into `milestone/m2-slash-menu` after each M1 merge, with a sync PR.
- No change of the saved data format. The command lists live in memory only.
- Aether reads no file of the Claude folder for this milestone.
- Windows 11 only. Node 24.15 or later for tests.
- The repository is public. Test data holds no real account data and no real skill names of the user.
- Commits are signed through 1Password.

## Decisions

| Decision | Who | Record |
|---|---|---|
| "Profile" means the Aether profile and its current Claude account (the Claude folder) | The user, 2026-11-26 and 2026-11-27 | `docs/decisions/0013-profiles-and-providers.md`, `0014-provider-accounts-and-agent-sessions.md` |
| The agent is the only source of the command list | The user, 2026-11-28 | This brief |
| The menu lists everything that Claude lists | The user, 2026-11-28 | This brief |
| The agent starts when a session opens, and on the "New session" page | The user, 2026-11-28 | `docs/decisions/0015-agent-start-on-open.md`, written in story S2 |
| The Customize page stays "coming soon"; decision 0008 does not change | The user, 2026-11-28 | This brief |
| M2 starts now from `milestone/m1-chat` | The user, 2026-11-28 | This brief |
| `@` lists the files like the GitHub Copilot app, as a second feature of M2 | The user, 2026-11-28 | This brief |
| The draft agent starts on intent, not at launch | The user, 2026-11-28 | Decision 0015, spec S3 |
| A failed start on open adds a transcript notice | The user, 2026-11-28 | Spec S2 |
| `/remote-control` is hidden from the menu | The user, 2026-11-28 | Spec S1 |
| No `#` menu in M2 | The user, 2026-11-28 | Spec S4 |
| Live checks use the subscription of the user | The user, 2026-11-27 | `docs/decisions/0011-claude-billing.md` |

## Assumptions and risks

| Item | How the milestone tests it |
|---|---|
| The adapter sends `available_commands_update` after `session/new` and after a resume, without a prompt. | B9 and B11, live. |
| A selected command sent as plain text runs in Claude Code over ACP. | B2, live with `/mcp`. |
| A cold start of Claude takes some seconds. The menu waits for it. | B7 tests the loading state. The last list per account and folder covers the wait after the first time. |
| Early starts use more memory: about 305 MB for each process. | B14 checks the idle limit. B12 checks that draft agents close. |
| An early `session/new` that never gets a prompt leaves an empty Claude session in the Claude folder. | B12, live in step 7: the validator counts the new files in the Claude folder of the test profile. An empty session file is an accepted gap if Claude writes one. |
| The trust question now shows when the session opens, not at Send. | B10. |
| M1 stories S10 and S11 still change `acp-agents.ts`, the composer area and `App.tsx`. | Sync PRs from `milestone/m1-chat`. CI on the milestone branch after each sync. |
| The model and the mode still apply at Send to an agent that started earlier. | B11 checks one `session/new`, and the A12 regression checks the mode and the model. |
| Claude reads a resource link in a later turn as it does in the first turn. | B17, live. |
| A walk of a large plain folder can be slow. | B19 with a limit of 50,000 files, and a slice test of the walk. |

## Accepted gaps

- No kind tag on the rows. Reason: the plain ACP list does not say which item is a skill. A later milestone can read the AIR metadata of the adapter or the Claude folder.
- The menu has no list before the agent sends its first list, unless a last list exists. Reason: the agent is the only source.

## Budget

29 agent runs.

- 4 stories at about 5 runs each: 20.
- Design review: 1.
- Validator: 2.
- Sync and rework: 6.
