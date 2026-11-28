# S1 Slash menu in a running session: story spec

Status: approved by the user on 2026-11-28 ("Approve"), after design review run 1. The user chose the recommended option (A) of each open choice that the user did not decide by name.

- Milestone: m2-slash-menu.
- Checks: B1, B2, B3, B4, B5, B6, B7, B8.
- Mockup: `s1-slash-menu.mockup.html`, states 1 to 6.
- Depends on: M1 S10 merged into `milestone/m1-chat` and synced. S10 also changes `acp-agents.ts`, `agent.port.ts`, `entry.ts`, `session-view.ts`, `transcript.store.ts`, `SessionPage.tsx` and `App.tsx`. S11 changes `send-message.handler.ts`, `entry.ts`, `session-view.ts`, `contracts.ts` and `composition.ts`.

## Facts from the adapter

`@agentclientprotocol/claude-agent-acp` 0.112.0, checked in the design review:

- After the response to `session/new`, `session/resume` and `session/load`, the adapter sends `available_commands_update` in a `setTimeout(0)` (`dist/v1/acp-agent.js` 7353-7368, called at 649, 785, 876, 897). No prompt is needed.
- The list is `query.supportedCommands()` of Claude Code, filtered by `getAvailableSlashCommands` (`dist/slash-commands.js`):
  - It drops `clear`, `cost`, `keybindings-help`, `login`, `logout`, `output-style:new`, `release-notes`, `todos`, and the terminal-bound commands of Claude Code.
  - An MCP prompt `x (MCP)` becomes `mcp:x`.
  - It adds `mcp`, and `remote-control` when Claude Code supports it (39-46, 92). `remote-control` lets claude.ai or the Claude mobile app continue the session.
  - It drops a name with a space and a second command of one name.
- Each command has `name`, `description` (can be `""`) and `input` (`{ hint }` or `null`). No kind is given to a client that is not AIR.
- The adapter sends the list again when the first `system/init` gives the terminal-bound commands (3350-3365), and when Claude Code reports `commands_changed` (3660-3670).
- The prompt `/name args` as plain text runs the command in Claude Code. The adapter answers `/mcp` itself (`dist/mcp-command.js`).

## Behavior

1. The agent port gets a new update `{ type: 'commands'; commands: AgentCommand[] }`. `AgentCommand` is `{ name: string; description: string; hint: string }`. `hint` is `""` when the agent gives none.
2. `providers/acp` translates `available_commands_update` into this update. It keeps the agent order. It drops an entry with a blank name. It drops `remote-control` (user decision, 2026-11-28: "Hide it"). It sends the whole list each time.
3. The list can come before the provider knows the agent session ID. The provider keeps the last list that arrives while its session ID is unknown, and emits it when the ID is set and matches (open choice 1, A).
4. The main process keeps the latest list of each owner in memory. An owner is a session ID, or a draft ID of S3. Nothing is saved.
5. The main process also keeps the last list for each pair (provider account ID, folder). Each list that comes sets it. The memory is lost at quit.
6. The state of an owner:
   - `ready`: its process sent a list.
   - `loading`: its process starts or runs, and sent no list yet.
   - `no-agent`: it has no process.
7. The query returns the list of the owner when the state is `ready`. In the states `loading` and `no-agent` it returns the last list of the pair, or an empty list. So a window that stays open after a release keeps its rows.
8. Each change of the list or the state sends the event `sessions.commands-changed` with the owner, the state and the list. A process that ends, for any reason, sets `no-agent`. The store hears it through the `gone` callback of `Processes`, which `drop`, `retire` and `release` all reach.
9. The renderer opens the menu when the text before the caret matches `^\s*\/(\S*)$`. Any other text closes it.
10. Filter: the query is the text after `/`, without case. Names that start with it come first, then names that contain it. Inside each group, the agent order stays. The description is not searched.
11. Keys: Down and Up move the selection and wrap. Enter (without Shift) and Tab insert the selected row. Escape closes the menu and keeps the text.
12. When the menu has no row to select (loading with no last list, no match, empty), Enter sends the text as usual and Tab does nothing. So a typed `/review` can always be sent.
13. Insert: the text from the `/` to the caret becomes a **command tag**: one inline token at the start of the text, with the caret after it. The user types the rest of the message after the tag. The menu closes. User decision, 2026-11-28: "when we select the skill with / it should show as a tag and the text would go after it".
14. The tag looks like the reference screenshot: a pill with a border, an icon and the command name (open choice 5). Its tooltip is the description.
15. While the text after the tag is empty, the hint of the command shows as the placeholder, for example `[pr]`.
16. A message has at most one tag, always at the start. With a tag in place, `/` is plain text.
17. The tag is atomic: the caret never stops inside it, and Backspace right after it removes it.
18. Send gives the agent `/<name> <rest>` as plain text, or `/<name>` with no rest.
19. The `user` entry saves the command name in an optional field `command`, and its text holds `/<name> <rest>`. The transcript shows the same tag at the start of that entry, also after a restart. A typed `/word` without a pick stays plain text.
20. Mouse: hover selects a row. A click inserts it.
21. The list shows at most 9 rows. It scrolls. The selected row stays in view after a key move.
22. An open menu updates when an event changes its list. The selection keeps the same name when it is still in the list, else it goes to the first row.
23. Aether runs no command itself. Claude Code runs it from the text.
24. S1 adds the menu and the tag to the reply composer of the session window. The "New session" page gets them in S3.
25. The text area of the reply composer becomes an editor with inline tokens (open choice 6). S4 adds the file mention to the same editor.

## Screens

Mockup `s1-slash-menu.mockup.html`:

1. Filled: the menu above the composer box, 4 rows, the first selected.
2. Filtered: `/co`.
3. Scrolled: 30 rows, the selected row 13 in view.
4. Loading with no last list: "Loading commands…" with a spinner.
5. Loading or no agent, with the last list: the rows, no mark.
6. No match, empty list, and no agent with no last list.
7. After a pick: the command tag at the start, the hint as placeholder, then with text after it.
8. The transcript: the user entry with the same tag.

- The menu sits above the composer box, at its full width. It does not push the transcript.
- Each row: the name in bold with its `/`, the hint in muted text, then the description in muted text. One line; a long description ends with an ellipsis and has the full text as its tooltip.
- The selected row has `--selected` as its background and a 2 px left bar in `--accent`.
- The row height is 32 px. The menu is at most 300 px high.
- The menu has `role="listbox"` and the label "Commands". Each row has `role="option"` and `aria-selected`. The text area has `aria-controls` and `aria-activedescendant`.

## Data

- No table, no column and no migration.
- Changed saved format: the JSON of a `user` entry gets an optional `command` (the command name). Old entries have none. zod validates it; no migration. Hot item for the user.
- New IPC formats: the query and the event below.

## Interfaces

As the plan says:

- Port (`agent.port.ts`): `AgentCommand` and the update kind `commands`.
- Provider (`acp-agents.ts`): `translateUpdate` maps `available_commands_update`; a deny list holds `remote-control`; rule 3 holds the early list.
- Store: `src/features/sessions/commands.store.ts` (new, in memory): `set(owner, pairKey, commands)`, `state(owner, state)`, `of(owner)`, `lastOf(pairKey)`. It emits `sessions.commands-changed`.
- Query slice `sessions.list-commands` (`src/features/sessions/list-commands/`): input `{ sessionId }`, or `{ draftId }` from S3. Result `{ state, commands }`. Error `unknown-owner`.
- Event `sessions.commands-changed`: `{ owner: { sessionId } | { draftId }, state, commands }`. It goes in `events` of `contracts.ts`.
- `record-agent-update`: on `commands`, it calls the store. The new dependency is optional (the locked S9 test calls it with `{ transcript, store }`).
- The start path (`send-message.handler.ts` today, `agent-start.ts` after S2): it sets `loading` and the pair key when a process starts.
- `sessions.send-message`: optional input `command`. The handler sends `/<command> <text>` and saves both. It refuses a command name with a space or a `/`.
- `entry.ts`: the `user` entry gets `command`.
- Renderer: `components/ComposerEditor.tsx` (new: text with inline tokens; its value is the plain text and the tokens with their places; it keeps the role `textbox` and the accessible name of today's text area, for the locked m1 tests); `src/renderer/src/slash.ts` (new, pure: `findSlash`, `filterCommands`); `components/CommandMenu.tsx` (new, generic rows `{ id, label, hint, description, icon? }` and a state text, reused by S4); `useCommands.ts` (new: query plus event); `ReplyComposer.tsx`; `Transcript.tsx` (the tag of a user entry).
- Simulated agent: the test author adds a way to send updates right after the response to `session/new` and `session/resume`, before any prompt, with no timer. One variant writes the list before the response, to test rule 3.

## Terms

- UI: "Commands" (menu label), "Loading commands…", "No command matches /<text>.", "Claude Code offers no commands here.", "Commands show when Claude Code runs.".
- Code: `AgentCommand`, `commands`, `CommandMenu`, `slash`, owner.

## Error and empty states

| Case | Menu |
|---|---|
| `loading` or `no-agent`, with a last list | The rows of the last list |
| `loading`, no last list | "Loading commands…" with a spinner |
| `ready`, empty list | "Claude Code offers no commands here." |
| No match | "No command matches /<query>." |
| `no-agent`, no last list | "Commands show when Claude Code runs." The reason is the start notice in the transcript (S2). |

## Checks

| Check | Given | When | Then | Test |
| --- | --- | --- | --- | --- |
| B1 to B8 | Brief | | | Acceptance; B2 and B8 also live |
| S1-1 | The provider | `available_commands_update` with 4 commands: one with `input: null`, one with a blank name, one `remote-control` | One update `commands` with 2 entries, in order; the hint of the `null` input is `""`. | Unit (provider) |
| S1-2 | The provider | The list comes before the `session/new` response | The listener gets the list once the session ID is set. | Unit (provider) |
| S1-3 | `filterCommands` | `review`, `preview`, `compact`, `mcp:github:pr`; query `pr` | `preview`, then `mcp:github:pr`. Query `re`: `review`, then `preview`. | Unit |
| S1-4 | `findSlash` | `"/re"`, `"  /re"`, `"hi /re"`, `"/re view"`, caret at the end | A match for the first two only. | Unit |
| S1-5 | The editor | The user picks `compact` from `/co`, types `now`, and sends | The tag `compact` is at the start; the agent gets `/compact now`; the entry has `command: compact` and shows the tag after a restart. | Acceptance |
| S1-10 | A tag `review` with hint `[pr]` | No text after it | The placeholder shows `[pr]`. Backspace removes the tag. | Acceptance |
| S1-11 | A tag in place | The user types `/` | No menu opens. | Unit (renderer) |
| S1-12 | The m1 tests that `fill` the reply composer | — | They find the editor by its role and name, as before. | Acceptance (regression) |
| S1-6 | The store | A list for session A with pair P; A's process is released; session B starts with pair P | A is `no-agent` and returns the list of P. B is `loading` and returns the list of P. | Unit |
| S1-7 | The menu on `review` | A new list without `review` | The selection moves to the first row. | Unit (renderer) |
| S1-8 | The menu with rows | The user presses Enter | The message is not sent; the row is inserted. | Acceptance |
| S1-9 | The menu with no match for `/zzz` | The user presses Enter | `/zzz` is sent. | Acceptance |

## Files and dependencies

- `src/building-blocks/agent.port.ts`
- `src/providers/acp/acp-agents.ts` and its test
- `src/features/sessions/commands.store.ts`, `list-commands/` (new), `record-agent-update/`, `send-message/send-message.handler.ts`, `processes.store.ts` (the `gone` callback)
- `src/app/contracts.ts`, `src/app/main/composition.ts`
- `src/renderer/src/slash.ts`, `useCommands.ts`, `components/CommandMenu.tsx` (new), `ReplyComposer.tsx`, `SessionPage.tsx`
- `tests/acceptance/m2-slash-menu/s1/` (new), `tests/simulated-agent/` (test author only)
- S2 moves the start code that S1 changes, so S2 starts after S1 merges.

## Open choices

The user decided: hide `remote-control` (2026-11-28). The design review recommends A for each choice below. No advisor ran in the review.

1. **The early list.** A (recommended): keep it until the session ID is set. B: accept any session ID in the update.
2. **Filter on the description.** A (recommended): name only. B: name, then description.
3. **Mark a last list.** A (recommended): no mark. B: a muted "Refreshing…" line.
4. **Kind tag at the right of a row.** Hot item. A (recommended): no tag in M2, as the brief accepts. B: tag `MCP` for `mcp:` names only.
5. **The label and icon of the command tag.**
   - A (recommended): the name as Claude gives it, without `/` (`review`, `mcp:github:pr`), and one icon for all commands (`lucide-react` `Package`, as in the screenshot). Impact: the label matches the menu row.
   - B: a title-case label, as in the screenshot ("Dagster Mcp"). Impact: Aether must guess words from names like `mcp:github:pr`.
6. **The editor with inline tokens.** Hot item: it replaces the text area of the reply composer now, and of the page in S3.
   - A (recommended): Lexical (MIT, from Meta), with a command node and later a mention node. Impact: a new library; caret, undo, IME and paste work well.
   - B: a small `contenteditable` of our own. Impact: no library, but caret, IME and undo need much code and tests.
   - C: a text area with a highlight layer. Impact: no library, but the token is not atomic and the icon is hard to place.
