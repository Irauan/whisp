# S11 Sidebar folders and session status: story spec

Status: approved by the user on 2026-11-28 ("Approve"): the mockup, the spec, the table `folders` and the column `sessions.unread` (migration 006). Added on 2026-11-28 by the user's decision: "Add S11 to M1 and raise the cap to 80". Design review run 75 checked the first draft (result: fail on 3 points); this version has its fixes.

- Milestone: m1-chat.
- Checks: A24, A25 (new).
- Mockup: `s11-sidebar-status.mockup.html`.
- Depends on: S3 (the sidebar), S4 (the status and turns), S5 (the cards), S6 (the trust question), S10 (the subscription of `App.tsx` to `sessions.changed`, and migration 005 before 006). S11 builds after S10 merges.

## Origin

The user tested M1 by hand on 2026-11-28 and compared the sidebar with the GitHub Copilot app. The user's words:

"We have too much space between the session group and the Session section title. The second and third images are from github copilot app. We should follow the same style/spacing, and when we hover over the group we should see the icon to collapse or expand and the plus icon to start a session into that folder. The group also should have the folder icon. The chat icon should fade in, fade out while the model is thinking and when it answer it should stay blue (fourth image) until I read it (the blue is the signal that the model answered so I can go back to that chat, the icon only get blue if the model answers and I'm in another chat or it is not focused). In cases where the model requires my attention to answer a question or decision the icon should change to a hand and be in yellow (the hand is like the model is raising his hand)"

Later the same day: "save the collapsed groups too", and "I think we need the group table. In copilot app I can add the folder or repository to sessions and it would exist even without any chat under it".

## Behavior

### Folders and groups

1. The sidebar shows one group for each folder of the profile (table `folders`), with its sessions under it, newest first. A folder with no sessions shows the muted line "No sessions yet" under it.
2. Order of the groups: the newest activity first (the newest session of the folder, or the time the folder was added).
3. A group row has a folder icon and the folder name. The full path is its tooltip. It is the same height as a session row.
4. Spacing: `.group-head` ("Sessions") keeps its `margin-top: 18px` above it. The first group row starts directly under the "Sessions" row: 0 to 4 px between them (the old group title padding `6px 8px 2px` goes away with the old title).
5. Session rows are indented by one icon width (28 px) under their group.
6. Structure of a group row: a container with two buttons:
   - the toggle button: the folder icon (a chevron on hover or focus) and the folder name. Its accessible name is the folder name. It has `aria-expanded`.
   - the "+" button: "New session in <folder name>". It shows on `:hover` and `:focus-within` of the container, so the keyboard reaches it.
   - a right click on the group row (or Shift+F10 or the context-menu key on the toggle) opens the folder menu. See rule 6a.
6a. The folder menu (user decision, 2026-11-28: "to remove an empty folder we should have a right click menu like copilot app"), in the GitHub menu style, at the pointer:
   - "New session" (`Plus` icon): the same as the "+" of the group.
   - Separator.
   - "Remove folder" (`Trash2` icon, `--danger` red): removes the folder from the sidebar (`folders.remove`). It is enabled only for a folder with no sessions. For a folder with sessions it is disabled, with the description "Delete its sessions first".
   - Left out of the Copilot menu: Show in Explorer, Settings, Hide, Customize, Move up, Move down, Manage sessions (Aether has no such feature in M1).
   - Escape, a click outside and a choice close the menu.
7. On hover or focus the folder icon changes to a chevron: right when collapsed, down when expanded.
8. A click on the toggle button, or Enter or Space on it, collapses or expands the group. The state is saved in `folders.collapsed`. The collapse state lives in `App`, so it does not reset when the sidebar hides.
9. A collapsed group expands when it gets a new session, or when the user opens one of its sessions (for example with Back).
10. A collapsed group shows the strongest status of its sessions at its right: the hand, then the blue icon. Working does not show on the group.
11. "+" of a group opens the New page with that folder chosen in the composer. It works also when the New page is open already, and for a second group: the composer takes the new folder (the `key` of `HomePage` includes the folder, or the composer reacts to the preset). The "New" row of the sidebar keeps the rule of today: the folder of the newest session.
12. The "+" of the "Sessions" heading opens a menu in the GitHub style, like the Copilot app:
   - "Start session in" (muted caption), then one row for each folder of the profile, with a folder icon. A row does the same as the "+" of that group.
   - Separator.
   - "Add from GitHub" and "Add from URL": disabled, "Coming soon".
   - "Add local folder or repository" (folder icon): the folder picker, then `folders.add`. The new group shows at once, empty.
   - Not in Aether: "Chat" (a session with no folder) and "More repositories".

### Status icon of a session row

Each session row shows one state. The first matching state wins:

| Order | State | Rule | Icon |
| --- | --- | --- | --- |
| 1 | Needs your answer | The session has an open permission card or question card (S5), or waits for the trust or directory question (S6) (open choice 5, A). | A raised hand (`Hand`), `--attention` yellow. |
| 2 | Working | The session status is `starting` or `working`. | The chat icon in `--text`, fading in and out (opacity 1 to 0.35, 1.6 s, ease-in-out, infinite). With `prefers-reduced-motion: reduce` it does not fade; it stays in `--accent`. |
| 3 | New answer | The session has the unread mark. | The chat icon, `--unread` blue. |
| 4 | Normal | Otherwise. | The chat icon, muted, as today. |

- Accessibility: the accessible name of the row button stays the session title, exactly. The state goes in an accessible description (`aria-describedby` to a visually hidden element with "Needs your answer", "Working" or "New answer"). The normal state has no description. The group status icon also uses a description. Reason: locked tests of S3, S4 and S10 find a row by its exact title.

### The unread mark

- A **turn end** is the end of a turn in `send-message`: the status goes from `starting` or `working` to `idle` (the `finally` of the turn). This includes a turn whose start fails (not signed in, trust refused, failed start).
- At a turn end, the session gets the unread mark when the session is not the viewed session, or the window does not have the focus. A normal end, a failed turn and a failed start count. A stop by the user and a turn that the quit of Aether ends do not (open choice 4, A).
- The mark clears when the session becomes the viewed session while the window has the focus, or when the window gets the focus while the session is the viewed session.
- The **viewed session**: the renderer sends `sessions.set-viewing { sessionId | null }` at its start (also after a reload of the page) and at each change of `view`: a click, Back, Forward, a reset, the move to the New page after a delete, and a profile switch. The main process sets it to null on the window event `closed`.
- The **focus**: the main process keeps one focus flag. It sets the flag from `BrowserWindow.isFocused()` when it creates the window, then from the window events `focus` and `blur`. At a turn end it reads only this flag. Tests send `emit('focus')` and `emit('blur')` to the window through `app.evaluate`; the product gets no test hook (decision 0009). The test windows are hidden (user decision 2026-11-27), so the flag starts false in the tests.
- One window: Aether has one window (the single-instance lock, `index.ts` 20-21). Two windows are out of scope.
- Accepted race: when the user leaves session A just before A's turn ends, and `set-viewing` arrives after the turn end, A gets no mark.
- The write of the mark and its event have the `gone` guard (a deleted session gets neither).
- Out of scope: a signal for an unread session of another profile.

## Screens

See the mockup:

1. Today, for comparison.
2. Folders and status icons, with an empty folder "tmp".
3. Hover on a group: chevron and "+".
4. A collapsed group with a session that needs the user: the hand at the right of the group row.
5. No folders: "No sessions yet", as today.
6. The "+" menu of "Sessions".

New color tokens in `styles.css`: `--unread: #4493f8` (the GitHub blue) and `--attention: #d29922` (the GitHub attention yellow). Icons from `lucide-react`: `Folder`, `ChevronRight`, `ChevronDown`, `Plus`, `X`, `MessageSquare`, `Hand`, `Github`, `Link`.

The mockup draws the group row as one element for the picture. The structure of rule 6 (a container with separate buttons) is the contract.

## Data

Migration 006:

```sql
CREATE TABLE folders (
  id         TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  path       TEXT NOT NULL,           -- an absolute path, as sessions.source_path
  collapsed  INTEGER NOT NULL DEFAULT 0 CHECK (collapsed IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (profile_id, path)
) STRICT;

ALTER TABLE sessions ADD COLUMN unread INTEGER NOT NULL DEFAULT 0 CHECK (unread IN (0, 1));
```

- The migration fills `folders` with each distinct `(profile_id, source_path)` of `sessions`, with `created_at` = the oldest session of that folder.
- `sessions.source_path` stays. It joins a session to its folder row by profile and path (open choice 7, A). No rebuild of `sessions`.
- Creating a session in a folder with no row adds the row in the same transaction.
- Deleting the last session of a folder keeps the folder row.
- `sessions.unread`: 1 = the unread mark. Saved, so it survives a restart (open choice 1, A).
- The working and the needs-you states are not saved. They come from the live status and the open cards (S4, S5). After a restart no session works, and open cards are `interrupted` (S5).

## Interfaces

- Slice folder `src/features/folders/` with the slices `add`, `set-collapsed`, `remove`, and a root store `folders.store.ts`.
  - `folders.add { profileId, path }`: the path must be absolute and an existing folder. A duplicate returns the existing row.
  - `folders.set-collapsed { folderId, collapsed }`.
  - `folders.remove { folderId }`: only for a folder with no sessions; else an error.
- `sessions.set-viewing { sessionId: string | null }`: a new slice in `src/features/sessions/set-viewing/`.
- Where the viewed session and the focus flag live: in a root file of the sessions feature (like `processes.store.ts`), so that `send-message` reads them without importing another slice. The composition root wires them. No new port (`docs/architecture.md`: ports are only for the agent, the database, Git, GitHub and the clock).
- `Composition` gets a method such as `windowFocus(focused: boolean)`, which `src/main/index.ts` calls from the window events, like `shutdown`.
- The turn end in `send-message` calls the unread rule with the session ID. Any new dependency of the `send-message` dependencies and of `Transcript` is optional, because locked tests build them without it (`tests/architecture/m1-chat-s9-retire-idle.test.ts` 219, `tests/architecture/m1-chat-s10-title-agent.test.ts` 208).
- `changeSchema` (`entry.ts`): the new change `{ type: 'unread'; unread: boolean }`. `applyChange` in `session-view.ts` handles it (no visible change in the session window; the revision moves on).
- `sessions.list`:
  - The list controller gets the `Transcript` (like `openSessionController`).
  - The result: `folders: { id, path, collapsed }[]`, and for each session a list item with its own schema in `list.contract.ts`: the saved fields, `unread`, and the live `status`, `openCardIds: string[]` and `revision` (the revision of its session events). `sessionSchema` does not get live fields.
- The sidebar map: `App.tsx` keeps a map by session ID, loaded from `sessions.list`. It applies the changes `status`, `card-opened`, `card-closed` and `unread` from `sessions.changed` for every session, in the order of the revision: an event at or below the revision of the item is dropped, and a gap calls `reload()`. It keeps the open card IDs, not a count.
- Navigation: the view `home` gets an optional `folder: string`.

## Terms

- UI: "Needs your answer", "Working", "New answer"; "New session in <folder>"; "Remove folder"; "Start session in"; "Add local folder or repository"; "No sessions yet".
- Code: `folders`, `unread`, `setViewing`, `windowFocus`.
- Database: `folders`, `sessions.unread`.

## Error and empty states

- No folders: "No sessions yet" under "Sessions", as today.
- An empty folder: "No sessions yet" under its group row.
- The folder picker is cancelled: nothing changes.
- `folders.add` refuses a path: the error shows as a notice in the sidebar error line of today (`App` error).
- A failed `sessions.set-viewing`: the sidebar keeps working; the error goes to the console.

## Checks

| Check | Given | When | Then | Test |
| --- | --- | --- | --- | --- |
| S11-1 | Two folders with sessions | The sidebar shows | Each group row has a folder icon and the folder name. The first group row starts 0 to 4 px under the "Sessions" row. Session rows are indented. | Acceptance |
| S11-2 | A group | The user hovers the group row; then tabs to it | The chevron replaces the folder icon, and "New session in <name>" shows, in both cases. | Acceptance |
| S11-3 | An expanded group | The user clicks the toggle, then presses Enter, then Space | `aria-expanded` goes false, true, false; the rows hide and show. | Acceptance |
| S11-4 | Folders F and G; the New page is open with F | The user clicks "New session in G" | The composer shows G. No session is created. | Acceptance |
| S11-5 | A started session | A turn runs (simulated agent at a gate) | Its row has the description "Working" and an animation. With reduced motion, no animation. After the turn, no "Working". | Acceptance (`emulateMedia`, `getAnimations`) |
| S11-6 | Sessions A and B; B is open; the window has the focus (`emit('focus')`) | A's turn ends | A has the description "New answer". The user opens A: the mark clears. | Acceptance |
| S11-7 | Session A open | `emit('blur')`, then A's turn ends, then `emit('focus')` | A gets "New answer", then the mark clears. | Acceptance, plus a unit test of the rule |
| S11-8 | Session A open, the window has the focus | A's turn ends | No mark. | Acceptance |
| S11-9 | A session with the unread mark | Aether restarts | The mark is still there. | Acceptance |
| S11-10 | Session A, not open | A permission card opens; then the agent withdraws it | A has "Needs your answer" (hand). After the withdraw, the hand goes away. | Acceptance |
| S11-11 | A collapsed group with a session that needs the user; another collapsed group with an unread session | The sidebar shows | The first group row shows the hand, the second the blue icon. | Acceptance |
| S11-12 | A session whose start fails (not signed in) while it is not open | The turn ends | A gets "New answer". A stop by the user sets no mark. | Acceptance |
| S11-13 | A collapsed group | Aether restarts; the user switches to another profile and back | The group is still collapsed. The other profile is not affected. | Acceptance |
| S11-14 | A profile with sessions in two folders | The user opens the "+" menu of "Sessions" | "Start session in" with the two folders; "Add from GitHub" and "Add from URL" disabled with "Coming soon"; "Add local folder or repository". | Acceptance |
| S11-15 | The "+" menu | "Add local folder or repository", a folder with no sessions (the picker test hook of S3) | A group with "No sessions yet" shows, and stays after a restart. "Remove folder" in its right-click menu removes it. | Acceptance |
| S11-16 | A folder with one session | The user deletes the session | The group stays, with "No sessions yet". | Acceptance |
| S11-24 | Folder F with no sessions, folder G with one | The user right-clicks F, then G | The menu shows "New session" and "Remove folder". For F, "Remove folder" removes the group. For G it is disabled. Escape closes the menu. | Acceptance |
| S11-17 | The status rule | Each combination of open cards, status and unread | The order of the table holds. | Unit |
| S11-18 | Migration 006 | A database at version 5: sessions in two folders of one profile, one of another | `folders` has three rows with the right profiles, paths and oldest times. `unread` is 0. A value 2 is refused for both checks. | Unit |
| S11-19 | `folders.add` and `folders.remove` | A missing path, a relative path, a duplicate; remove of a folder with sessions | Refused, refused, the existing row; refused. | Unit |
| S11-20 | The sidebar map | An event at or below the item revision; a gap | Dropped; a reload. | Unit |
| S11-21 | The renderer | Start, a click, Back, Forward, a delete that goes to New | `set-viewing` is sent each time with the right ID. | Unit |
| S11-22 | `sessions.list` while a turn runs | A reload | The item has `status: working`, the open card IDs and the revision. | Unit |
| S11-23 | The window state | A change `unread` | The revision moves on; nothing else changes. | Unit (`session-view.test.ts`) |

Brief rows:
- A24: "The sidebar shows the folders like the GitHub Copilot app: folder icon, collapse (saved), '+' to start a session in a folder, and folders that stay without sessions."
- A25: "The session icon shows Working (fading), New answer (blue, until opened), and Needs your answer (yellow hand)."

## Locked tests

- The accessible name rule above keeps the locked row finders of S3, S4 and S10 working. No locked test reads the old group title.
- `tests/acceptance/m1-chat/s1/coming-soon.spec.ts` 15 does not match the new names (checked).
- If the test author finds a locked test that the change breaks, the trailer is `Locked-Test-Change: S11 sidebar folders and status (user decision 2026-11-28)`, and the coordinator approves it.

## Files and dependencies

- Renderer: `Sidebar.tsx`, `styles.css`, `navigation.ts`, `Pages.tsx`, `SessionComposer.tsx`, `App.tsx`, `useProfiles.ts`, `session-view.ts` and its test.
- Main: `src/features/folders/` (new), `src/features/sessions/set-viewing/` (new), `list/` (contract, controller, handler), `send-message.handler.ts`, `session.store.ts`, `transcript.store.ts`, `entry.ts`, a new root file for the viewed session and the focus, `src/app/contracts.ts`, `src/app/main/composition.ts`, `src/main/index.ts`.
- Database: `src/database/migrations/006-folders-and-unread.sql`.
- Docs: `docs/architecture.md` (State: the main process holds the viewed session and the focus flag; the folders feature), `brief.md` (A24, A25), `plan.md` (the S11 row).
- Tests: `tests/acceptance/m1-chat/s11/`, `tests/architecture/m1-chat-s11-*.test.ts`.

## Open choices

1. **Unread mark after a restart.** A (recommended): saved (`sessions.unread`). The user said "until I read it". User column: yes (saved format). Hard to revert: no. Advisor: A; the user likely agrees.
2. **Collapsed groups after a restart.** Decided by the user: saved (`folders.collapsed`).
3. **Status on a collapsed group.** A (recommended): the group row shows the hand, then the blue icon. User column: no. Hard to revert: no. Advisor: A.
4. **Which turn ends set the mark.** Decided by the user on 2026-11-28: A ("Answers and errors"). The user named the case "when it answer".
   - A (recommended): a normal end, a failed turn and a failed start set it. A stop by the user and a turn that the quit of Aether ends do not. Impact: errors in the background show; a quit leaves no false blue icons.
   - B: only a normal end sets it.
   - C: every turn end sets it, also stops and the quit.
   - User column: yes (the advisor predicts that the user may disagree). Hard to revert: no.
5. **The trust and directory questions.** Decided by the user on 2026-11-28: A ("Yellow hand"). A session that waits for the trust question (S6) has the status `starting`, so it shows "Working".
   - A (recommended): count it as "Needs your answer" (the renderer already knows the open question and its session). Only the renderer changes.
   - B: it stays "Working". The question is a modal dialog in the window anyway.
   - User column: yes (the user named the model raising its hand). Hard to revert: no.
6. **Remove a folder from the sidebar.** Decided by the user on 2026-11-28: "Remove folder" in a right-click folder menu like the Copilot app. Only an empty folder can be removed in M1.
7. **How a session points to its folder.** A (recommended): join by `(profile_id, path)`; no rebuild of `sessions`. B: `sessions.folder_id` with a foreign key, which needs a rebuild of `sessions`. User column: yes (saved format). Hard to revert: B is harder. Advisor: A.
8. **Where the state name goes** (decided by the advisor, recorded): the accessible description, not the name.
9. **How the main process knows the focus** (decided by the advisor, recorded): one flag from the window events, behind a `Composition` method, with no port.
