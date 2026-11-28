# S10 Session title from Claude: story spec

Status: approved by the user on 2026-11-28 ("Approve"): the mockup, the spec and the new column `sessions.title_source`. Added on 2026-11-28 by the user's decision: "add it to M1 as S10." Design review run 70 checked the first draft; this version has its fixes.

- Milestone: m1-chat.
- Check: A23 (new).
- Mockup: see "Screens". The header part waits for the user's answer.
- Depends on: S4 (the agent updates and the session events), S8 (the header), S5 (the port updates `mode` and `model`), S9 (the idle time). All are merged.

## Origin

The user tested M1 by hand on 2026-11-27 and asked: "How are we defining the session name? It looked to me that we just used the first message as the name. When using claude or other chat tools it looks like they name the session by the context of the message."

Today `titleOf` in `src/features/sessions/session.ts` makes the title from the first line of the first message, cut at 100 characters (`TITLE_LIMIT`).

Facts from the Claude adapter (`@agentclientprotocol/claude-agent-acp` 0.112.0), checked in the design review:

- The adapter sends `session_info_update { title, updatedAt }` to an ACP version 1 client with no client capability (`dist/session-titles.js` 298-315). `session_info_update` is in the stable v1 `SessionUpdate` union, with `title?: string | null`.
- When the first prompt has 10 characters or more, the adapter asks for the title at prompt time, so the title comes during the turn. A shorter prompt ("hi") gets its title at the turn end, about 2 s after the Aether turn ends, so outside the turn (`session-titles.js` 138; `v1/acp-agent.js` 3605, 3638).
- When the model gives no title, the adapter sends a fallback: the raw first prompt on one line, at most 256 characters (`session-titles.js` 34-55, 202-215).
- In v1 a resumed process does not send the stored title at the resume. It sends a title only after the next prompt, or at the turn end.
- Other `session_info_update` messages have no `title` field (prompt suggestions, failures, archive). Aether ignores them.

## Behavior

1. When the agent reports a title, Aether saves it as the title of the session and shows it.
2. The first line of the first message stays the title until a title from the agent comes. The agent's title can also be its fallback: the whole first prompt on one line. Aether accepts it as any other title.
3. Aether cleans the reported title with `titleOf` first (first line, no space around it, cut at `TITLE_LIMIT`). Then it checks for blank. Example: `"\nGreeting"` becomes `""` and changes nothing.
4. A blank or missing title, or a clean title equal to the saved one, changes nothing and sends no event.
5. The store saves the title first. The event goes out only after a successful save. A failed save sends no event, so the shown title does not change.
6. A title can come during a turn or outside a turn. Both change the title. Outside a turn, it restarts the idle time of S9 like every other agent update (open choice 2, B). No S9 rule changes.
7. A later title replaces an earlier one.
8. A title for a deleted session changes nothing: no write and no event.

## Screens

The title text changes in two places, without a restart and without a click:

- the title of the session window
- the row of the session in the sidebar, also when the session is not open

### Header layout (user decision, 2026-11-28)

Mockup: `s10-session-title.mockup.html`, states 0 (today) to 4. The user's words: "I want to make it look like the session from claude. It stays in the same line as the search button, and has a dropdown menu to shoe the options." And: "only clicking the arrown opens the menu, and the menu style follows the github app. The title is separated from the arrow (this is the part that we should follow from claude)".

- The title moves into the title strip of the main area (`.title-strip`, 44 px, the drag region), on the line of the sidebar buttons and the window buttons. Left aligned, semibold, one line.
- The S8 header row (`.session-head`, its large title, its trash button and its bottom line) goes away. The transcript starts under the strip.
- The title is plain text. A click on it does nothing. It is not a drag target conflict: the arrow and the title are `no-drag` only where they need it (the arrow is a button).
- A separate arrow button follows the title. Accessible name: "Session options". Only the arrow opens the menu.
- A long title ends with an ellipsis. The arrow stays in view. The full title is the tooltip of the title.
- The menu has the items of the Claude app menu that Aether can support, in Claude's order and with Claude's shortcut letters. The user's words: "the menu should present the same options as the claude as well." And: "we should follow the github app style adding icons to the actions."
- Style: the GitHub style of the app menus (`.menu`): each row has an icon, groups have separators, the danger row is in `--danger` with a red trash icon. A shortcut letter shows muted at the right. A submenu row shows "›".
- Items of a started session:
  1. "Rename" (pencil, R). The title turns into a text field named "Session title" in place, with the title selected. Enter saves, Escape and a click outside cancel. A blank title is refused (the field stays). The saved title is cleaned with `titleOf`.
  2. "Fork" (branch icon), disabled, with the "Coming soon" pill, as "Pull requests" in the sidebar.
  3. Separator.
  4. "Archive" (archive icon), disabled, with "Coming soon".
  5. "Delete" (trash, D), red. It runs the same command and confirmation as the trash button today.
- Items of a draft: only "Discard draft" in red. A draft is a saved session that has not started, as in S3 and S8. "Discard draft" asks the same confirmation as Delete (coordinator decision, 2026-11-28).
- Left out: "Open in" (user decision, 2026-11-28: "you can remove the open in menu"), and the items that Aether has no feature for: Share, Detach to top level, Transcript view, Output style, Continue in cloud.
- With the menu open, a shortcut letter runs its item. Escape, a click outside and a choice close the menu. Only Escape and a choice put the focus back on the arrow: a click outside leaves the focus where the user clicked. After "Delete" and Cancel in the dialog, the focus goes back to the arrow. In the Rename field, Enter and Escape put the focus back on the arrow; a click outside cancels and leaves the focus where the user clicked (coordinator decision, 2026-11-28).
- A draft shows the title "New session".

The S8 rule "the header holds only the title and Delete session" changes: the title and "Delete session" stay, but in the strip and the menu (the menu item "Delete"). This is a change of an approved S8 screen, so the user approves this mockup.

## Data

- No new table and no new column. `sessions.title` (migration 001, `TEXT NOT NULL`) holds the title.
- Changed use of a saved column: `sessions.title` now changes after the first message, when the agent reports a title.
- New column (migration 005): `sessions.title_source TEXT NOT NULL DEFAULT 'prompt'`, with no CHECK. The store validates the value in code (`'prompt' | 'agent' | 'user'`) and refuses another value. Coordinator decision, 2026-11-28, by user preference 5: a rule in code, not in the database, when a database rule needs a table rebuild to change. Existing rows get `prompt`. A title from the agent sets `agent`. A rename sets `user`. Open choice 1 is now B, because Rename is in S10.
- Rule: a title from the agent never replaces a title with the source `user`. The update is ignored, with no event.
- This is a new saved format, so the user approves it in this design review.

## Interfaces

- Port (`src/building-blocks/agent.port.ts`): a new `AgentUpdate` kind `{ type: 'title'; title: string }`. It names no protocol.
- Provider (`src/providers/acp/acp-agents.ts`): a `session_info_update` with a string `title` becomes the port update `title`. A `session_info_update` with a null title or no `title` field gives no update. `updatedAt` and `_meta` are ignored.
- Slice `record-agent-update`: the update `title` cleans the title, saves it in the store, then sends a session event through the transcript.
  - Any new dependency of `recordAgentUpdateHandler` must be optional. The locked test `tests/architecture/m1-chat-s9-retire-idle.test.ts` 193 calls it with `{ transcript, store }` only.
- Session store: a new method to set the title, like `setModel`. It returns false for an unknown session. The locked test S10-16 names it `setTitle(id, title, source)`, with the source `agent` or `user`. For a bad source it throws or returns false, and it writes nothing.
- Transcript (`transcript.store.ts`): a new `setTitle` with the `gone` guard, like `setModel`, which emits the change.
- Session event (`entry.ts`, `changeSchema`): a new change `{ type: 'title'; title: string }`.
- Window (`session-view.ts`): the change `title` sets `view.session.title`. Fix the comment at line 66 ("No other event changes the session row").
- Sidebar: `App.tsx` subscribes to `sessions.changed` and calls `reload()` of `useProfiles` on a change of type `title`, for any session. The store saves before the event, so the reload reads the new title.
- Simulated agent: no change. Its files are locked. The `steps` scenario with `{ do: 'update', update: { sessionUpdate: 'session_info_update', title } }` sends a title in a turn. `{ do: 'detach', steps }` behind a gate sends one outside a turn.

## Terms

- UI: "title" of a session, as today.
- Code: `title` in the port, the event, the transcript and the store.
- Database: `sessions.title`, as today.

## Error and empty states

- No title from the agent: the first line stays. No notice.
- A failed save: no event; the shown title stays. The error goes up to the caller, as for `setModel`.
- A title for an unknown or deleted session: ignored.

## Checks

| Check | Given | When | Then | Test |
| --- | --- | --- | --- | --- |
| S10-1 | A started session titled from its first message | During the turn, the agent sends `session_info_update` with the title "Greeting test" | The window title and the sidebar row show "Greeting test". After a restart of Aether the session keeps this title. | Acceptance |
| S10-2 | A started session, its turn ended | Outside a turn (detach behind a gate), the agent sends the title "Late title" | The window title and the sidebar row show "Late title". | Acceptance |
| S10-3 | Two started sessions; session B is open | The agent of session A sends a title | The sidebar row of A shows the new title. The window of B does not change. | Acceptance |
| S10-4 | A started session | The agent sends a blank title, `"\nGreeting"`, or a title equal to the saved one | The title does not change, and no event goes out. | Unit |
| S10-5 | A started session | The agent sends a title with two lines and 150 characters on the first line | The saved title is the first line, cut at 100 characters. | Unit |
| S10-6 | A deleted session | A title update for it comes | No write and no event. | Unit |
| S10-7 | The provider | `session_info_update` with `title` and `updatedAt`; then one with `title: null`; then one with only `_meta` | The listener gets one update `{ type: 'title', title }` for the first, and none for the others. | Unit (provider) |
| S10-8 | The window state | A `title` change comes | `view.session.title` is the new title. | Unit (`session-view.test.ts`) |
| S10-9 | A started session, idle | A title comes outside a turn | The idle time restarts, as for other updates. | Unit (`send-message.test.ts`) |
| S10-10 | A started session | The window shows | The title strip holds the title and the button "Session options". No header row with a trash button shows. | Acceptance |
| S10-11 | A started session | The user clicks the title, then the arrow, then the menu item "Delete" | The title click opens nothing. The arrow opens a menu with "Delete". "Delete" asks the same confirmation as today. | Acceptance |
| S10-14 | A started session | The user chooses "Rename", types "My name" and presses Enter; then the agent sends the title "Agent name" | The title is "My name" in the strip and the sidebar, also after a restart. The agent title changes nothing. Escape in the field keeps the old title. A blank title is refused. | Acceptance |
| S10-15 | A started session | The user opens the menu | The items are "Rename", "Fork", "Archive", "Delete", in this order. "Fork" and "Archive" are disabled with "Coming soon". Each row has an icon. "Rename" shows "R" and "Delete" shows "D". | Acceptance |
| S10-16 | Migration 005 | A database at version 4 with sessions | Each session has `title_source = 'prompt'`. The store refuses a bad value; the database has no CHECK. | Unit |
| S10-12 | A draft | The user opens the arrow menu | The title is "New session", and the menu shows "Discard draft". | Acceptance |
| S10-13 | The menu is open | The user presses Escape | The menu closes, and the focus is on the arrow. | Acceptance |
| A23 | A real Claude session (live, step 7) | The user sends a first message of 10 characters or more | Within a few seconds the title changes from the first line to Claude's title, or to the adapter's fallback title. | Live check of the validator |

Brief row A23 is new: "The user sends the first message. Claude names the session; the window title and the sidebar show its title."

## Locked tests that change

The header change breaks locked tests that expect a visible button "Delete session" in the page header:

- `tests/acceptance/m1-chat/s3/sessions.spec.ts` (S3 delete, 117-133): the button is now the menu item "Delete" behind "Session options" ("Discard draft" in a draft). The confirmation dialog stays the same.
- `tests/acceptance/m1-chat/s8/frame.spec.ts` (67-79, 214-243) and `frame.ts` 18: the header row is gone. The title and "Session options" are in the strip, always in view.

The title stays a heading of level 1, so the tests that find the title by `getByRole('heading')` keep their meaning. The test author changes only these lines, with the trailer `Locked-Test-Change: S10 moves the title and Delete session into the title strip and its menu (user decision 2026-11-28)`, and the coordinator approves it. The meaning of each check stays: the title is in view, and "Delete session" asks first.

## Files and dependencies

- `src/building-blocks/agent.port.ts`
- `src/providers/acp/acp-agents.ts` and its test
- `src/features/sessions/record-agent-update/` (handler and test)
- `src/features/sessions/session.store.ts`, `transcript.store.ts`, `entry.ts`
- `src/renderer/src/session-view.ts` and its test, `src/renderer/src/App.tsx`
- The header: `SessionPage.tsx`, the title strip of the shell, `Menu.tsx` (reuse), `styles.css`
- `src/features/sessions/send-message/send-message.test.ts` (S10-9 only; no handler change)
- `tests/acceptance/m1-chat/s10/` (new)
- Records: `brief.md` (A23), `plan.md` (S10 row and the A23 row of the check map)
- No other story is open, so no file conflict.

## Open choices

1. **Protect a title that the user typed.** Decided by the user's request for Rename (2026-11-28): B, the column `title_source` in migration 005. Aether ignores agent titles after a rename. Telling the adapter about the rename (its `setExplicitTitle`) is not in M1: Aether keeps its own title, and the adapter's stored title does not show in Aether.
2. **Idle time for a title outside a turn.**
   - B (recommended): it restarts the idle time like every other update outside a turn. No code change, and no S9 rule changes. Impact: for a short first message, the idle start moves about 2 s later.
   - A: it does not restart the idle time. Impact: a special case in `send-message.handler.ts` 204-207 and a change to the approved S9 rule.
   - User column: no. Hard to revert: no. Advisor: B; the user likely agrees (pattern 4).
3. **Title for a draft.** A draft has no process, so no agent title comes. No choice needed.
