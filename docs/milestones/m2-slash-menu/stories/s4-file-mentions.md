# S4 File list for `@`: story spec

Status: approved by the user on 2026-11-28 ("Approve"), after design review run 1. The user chose the recommended option (A) of each open choice that the user did not decide by name.

- Milestone: m2-slash-menu.
- Checks: B15, B16, B17, B18, B19.
- Mockup: `s4-file-mentions.mockup.html`, states 1 to 7.
- Depends on: S1 (`CommandMenu`, `ComposerEditor`), S3 (the draft ID that names the folder of the page). S4 starts after S3 merges.

## Today

- `@` and `#` work only in `SessionComposer.tsx`. `useSuggestions.ts` calls `window.aether.listRepositoryFiles(folder)` and `listIssues(folder, login)`: raw IPC handlers (`src/main/index.ts` 110-112), not contracts.
- `listRepositoryFiles` (`src/main/repository.ts` 45) runs `git ls-files -z --cached --others --exclude-standard` through the helper `git()` (line 9), with `-c core.fsmonitor=false` and a safe `cwd` (13-18). It keeps 50,000 files and lists every folder first. A plain folder returns "The folder is not a Git repository."
- The menu shows at most 20 rows (`MAX_SHOWN`), filters by substring of the path, has no icons and opens below the text.
- A picked item becomes an attachment chip. Chips go with the first message (decision 0012).
- `ReplyComposer.tsx` has no `@`, no chips, and "Add context" is disabled.
- No Git port exists in `building-blocks`; only `github.port.ts`.

## Behavior

### The `#` menu goes away

1. Aether removes the `#` menu and the "Issue or pull request…" item (user decision, 2026-11-28: "# shouldn't have a menu … At this point we should have only the menu for / and @"). `#` is plain text again.
2. The placeholder of the page becomes "Ask anything. Use @ for files, / for commands."
3. Saved issue and pull request attachments of imported drafts still send their URL, as decision 0012 says. Only the menu goes.
4. `listIssues` stays in the GitHub provider for a later milestone, but no IPC handler and no bridge entry call it.

### The file list

5. A new slice `repositories.list-files` gives the list. Input `{ sessionId }` or `{ draftId }`. The main process reads the folder from the session row or the draft record, never from the renderer.
6. It refuses a UNC path (`\\server\share`), as the architecture asks before any answer.
7. Git repository: `git ls-files` as today, through a new Git port and a provider `src/providers/git/` that keeps the safety options of today. Aether merges the tracked and the untracked lists, removes duplicates, sorts by path in byte order, then cuts at 50,000 files. So `.claude/…` and `.github/…` come first.
8. When `git ls-files` fails (for example a broken `.git` folder), Aether walks the folder instead.
9. Plain folder: a walk that skips folders named `.git` and `node_modules`, follows no link or junction, and stops at 50,000 files or 20,000 folders. The same sort and cut apply.
10. The result holds the files, the folders that hold them, and `truncated` when a limit stopped the list. Paths use `/`.
11. The renderer reads the list again each time `@` opens a menu, and keeps it while that menu is open.

### The menu

12. `@` opens the menu at the start of the text or after a space (`findMention`), in `SessionComposer` and in `ReplyComposer`.
13. The menu is `CommandMenu` of S1, above the composer box, with the same keys, mouse, scroll and 9 visible rows.
14. Without text after `@`: the files in list order. No folder row.
15. With text: files whose file name starts with it, then files whose file name contains it, then files whose path contains it, then folders whose path contains it. Each group keeps the list order. Case does not matter.
16. The menu renders at most 100 rows. When more rows match, the last row says "Type more to narrow the list." It cannot be selected.
17. When the list is `truncated`, a muted line at the bottom says "Aether read the first 50,000 files of this folder."
18. Each row: an icon for the file type, then the path. A folder row has the folder icon and ends with `/`.
19. Icons from `lucide-react`, with the colors of the screenshot:

| Files | Icon | Color |
|---|---|---|
| `.md`, `.mdx` | `FileDown` | blue |
| `.json`, `.jsonc` | `Braces` | orange |
| `.yml`, `.yaml` | a lucide icon that does not read as a warning, for example `FileCog` | purple |
| `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.css`, `.html` | `FileCode` | muted |
| other | `File` | muted |

### Pick and send: an inline link, not a chip

User decision, 2026-11-28: "when we select the file with @ it should be shown as a link and not as a chips/tag". The reference is the GitHub Copilot app: a file icon and the file name in the link color, inside the text, with the path as a tooltip.

20. Enter, Tab or a click replaces the text from `@` to the caret with a **mention**: one inline token in the text. It shows the file-type icon and the file name (a folder shows its name and `/`) in the link color (`--accent`). A space follows it.
21. Hover on a mention shows its path from the folder root, as a tooltip. A click does nothing in M2 (open choice 5).
22. A mention is atomic. The caret cannot go inside it. Backspace right after it, or Delete right before it, removes the whole mention. Copy gives `@<path>` as plain text. Paste of `@<path>` text stays plain text: it is no mention.
23. Mentions work in both composers. The "+" pickers ("Files…", "Folder…") keep their chips in the list "Attachments", as today: the locked test fixture `tests/acceptance/m1-chat/s7/fixture.ts` 33-34 and 111 uses that list.
24. The text for the agent has `@<path>` at the place of each mention, so the sentence stays whole. Each mention also gives one resource link with that turn.
25. On the "New session" page the mentions are attachments of the row, as the chips of `@` are today. So the first message keeps the rules of decision 0012. The saved prompt holds `@<path>` at each place.
26. In a reply, `sessions.send-message` gets an optional `mentions` input: `repository-file` and `repository-folder` only. The main process resolves each path from the session folder. It refuses an absolute path, a path with `..`, and a path whose real path leaves the folder.
27. The `user` entry saves its mentions, so the transcript shows each `@<path>` of the text as the same inline link after a restart. Open choice 1: a saved format change for the user.
28. A mention adds no additional directory.
29. The builder adds a note to decision 0012 for links on later turns, and updates `send-message.contract.ts` 9-10 and `docs/architecture.md`.

## Screens

Mockup `s4-file-mentions.mockup.html`:

1. `@` on the page: the files with icons, the first selected, the menu above the box.
2. `@app`: file names first.
3. `@src`: files under `src/`, then the folder rows.
4. The composer with an inline mention after a pick, and its tooltip.
5. The user entry with the same inline link in the transcript.
6. States: loading, no match, empty folder, "Type more to narrow the list.", the 50,000 line.
7. Errors: "Choose a folder first.", "Aether could not read the folder.".

## Data

- Changed saved format: the JSON of a `user` entry gets an optional `mentions` array: `{ kind: 'repository-file' | 'repository-folder', ref, label }`. The text holds `@<ref>` at each place. Old entries have none. No migration: zod validates the JSON, and the field is optional.
- The prompt of a session row holds `@<ref>` for each mention of the page. Its `attachments` keep the mentions as today.

## Interfaces

- Port `src/building-blocks/git.port.ts` (new): `listFiles(folder)`. Provider `src/providers/git/` (new). The composition root connects them. This is an interface between modules: the advisor decides its shape.
- Slice `repositories.list-files` (`src/features/repositories/list-files/`): contract, controller, handler. Result `{ files: string[]; folders: string[]; truncated: boolean }`. Errors `unknown-owner`, `invalid-folder`.
- `sessions.send-message`: optional `mentions`. Errors `unsupported-attachment` and `invalid-attachment`.
- `entry.ts`: the `user` entry gets `mentions`.
- `ComposerEditor` of S1 gets a mention token.
- Renderer: `useSuggestions.ts` calls the new slice; `fileRows.ts` (new, pure: order, filter, icons); `CommandMenu`; `ComposerEditor.tsx` (from S1: the mention token); `ReplyComposer.tsx` (`@`, mentions of a turn); `Transcript.tsx` (links in a user entry); `SessionComposer.tsx` (no `#`, new placeholder, mentions instead of `@` chips).
- Remove: `repository:files` and `issues` handlers in `src/main/index.ts`, `listRepositoryFiles` in `src/main/repository.ts`, and their preload and bridge entries.

## Terms

- UI: "mention" (code and specs only), "Files" (menu label), "Loading files…", "No file matches @<text>.", "This folder has no files.", "Type more to narrow the list.", "Aether read the first 50,000 files of this folder.".
- Code: `list-files`, `fileRows`, `GitPort`.

## Error and empty states

| Case | Menu |
|---|---|
| Loading | "Loading files…" with a spinner |
| No match | "No file matches @<text>." |
| Empty folder | "This folder has no files." |
| More than 100 matches | 100 rows, then "Type more to narrow the list." |
| A limit stopped the list | The line "Aether read the first 50,000 files of this folder." |
| No folder on the page | "Choose a folder first." |
| The folder is gone, a UNC path, or a read error | "Aether could not read the folder." |
| A picked file was deleted before Send | Aether sends the link. Claude reports it. |

## Locked tests of m1-chat that change meaning

- The m1 tests that type into the composer with `fill` can need the editor to keep the role `textbox` and its name. The test author checks them. The builder keeps the accessible name of each text area.
- `tests/acceptance/m1-chat/s8/composer.spec.ts` 84: the reason text "a running session takes no new attachment in m1" is no longer true. "Add context" stays disabled, so the check still passes. The test author changes the text with the trailer `Locked-Test-Change: S4 adds @ attachments to the reply composer (user decision 2026-11-28)`.
- No locked test uses the `#` menu.

## Checks

| Check | Given | When | Then | Test |
| --- | --- | --- | --- | --- |
| B15 | Brief | | | Acceptance |
| B16 | Brief | | | Acceptance |
| B17 | Brief | | The inline link shows after a restart. | Acceptance; live |
| B18 | Brief. The test trusts the folder first. `git ls-files` fails in it, so the walk runs. | | | Acceptance |
| B19 | Brief, changed: a repository with more than 100 matching files | The user types `@` | 100 rows, then "Type more to narrow the list." | Acceptance |
| S4-1 | `fileRows` | `a/app.ts`, `b/apple.md`, `src/my-app.ts`, `docs/app/x.md`; query `app` | `a/app.ts`, `b/apple.md`, `src/my-app.ts`, `docs/app/x.md`, then the folder `docs/app/`. | Unit |
| S4-2 | The walk | 60,000 files | 50,000 files, sorted, `truncated`. | Slice |
| S4-3 | The walk | A junction to a folder outside it | Not followed. | Slice |
| S4-4 | `send-message` | Attachment `../secret.txt`, or `C:/x.txt` | `invalid-attachment`; no turn starts. | Slice |
| S4-5 | Old entries | User entries of m1-chat | They load, with no mentions. | Unit |
| S4-9 | A mention in the composer | Backspace right after it; then Left into it | One Backspace removes it; the caret never stops inside a mention. | Acceptance |
| S4-10 | A reply "Check @.github/workflows/ci.yml now" with one mention | Send | The agent gets that text and one resource link. The transcript shows `ci.yml` as a link with the path as tooltip, also after a restart. | Acceptance |
| S4-11 | The page | The user picks `README.md` with `@`, then adds a file with "Files…" | `README.md` is an inline link; the picked file is a chip in "Attachments". | Acceptance |
| S4-6 | The preload and the bridge | — | No `listRepositoryFiles` and no `listIssues`. | Unit |
| S4-7 | The page | The user types `#` | No menu opens. | Acceptance |
| S4-8 | `list-files` | A session whose folder is `\\server\share\x` | `invalid-folder`; no read. | Slice |

## Files and dependencies

- `src/building-blocks/git.port.ts`, `src/providers/git/` (new)
- `src/features/repositories/list-files/` (new)
- `src/features/sessions/send-message/`, `entry.ts`
- `src/main/index.ts`, `src/main/repository.ts`, `src/preload/index.ts`, `src/shared/bridge.ts`
- `src/renderer/src/useSuggestions.ts`, `mention.ts`, `fileRows.ts` (new), `components/SessionComposer.tsx`, `ReplyComposer.tsx`, `Transcript.tsx`
- `docs/decisions/0012-session-settings.md` (note), `docs/architecture.md`
- `tests/acceptance/m2-slash-menu/s4/` (new)

## Open choices

The user decided: no `#` menu in M2 (2026-11-28).

1. **Mentions in the saved entry.** Hot item: a saved format change.
   - A (recommended): the `user` entry saves `mentions`. Impact: the links show after a restart; an optional field, no migration.
   - B: save only the text with `@<path>`. Impact: after a restart the path shows as plain text.
2. **Icons.** A (recommended): `lucide-react` with the screenshot colors. B: a file icon pack (a new library).
3. **The walk.** A (recommended): skip `.git` and `node_modules`, no links, the limits of rule 9. B: also apply `.gitignore` (a parser or a library).
4. **Menu above the box on the page.** A (recommended): above, as in the session window and the screenshot. B: below on the page.
5. **A click on a mention.** A (recommended): nothing in M2; the tooltip shows the path. B: open the file in the default app through the main process. Impact: a new IPC and a security rule for local files.
6. **The editor.** S1 open choice 6 decides it. S4 adds a mention token.
