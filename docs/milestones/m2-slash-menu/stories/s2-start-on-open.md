# S2 Agent starts when a session opens: story spec

Status: approved by the user on 2026-11-28 ("Approve"), after design review run 1. The user chose the recommended option (A) of each open choice that the user did not decide by name.

- Milestone: m2-slash-menu.
- Checks: B9, B10, B14.
- Decision: 0015 (new, refines 0006). The builder writes it from the brief and this spec.
- Mockup: none. S2 adds no screen. See "Screens".
- Depends on: S1 (merged first: both change the start code in `send-message.handler.ts`). M1 S11 (`sessions.set-viewing`, `App.tsx`) if it merged before S2 starts. See open choice 3.

## Scope

- S2 covers a **started** session: it has an agent run. A draft row and the "New session" page are S3.

## Behavior

1. When the user opens the window of a started session that has no process, Aether starts the agent at once. It resumes the agent session of the last agent run, as a Send after a release does.
2. "Opens" means a navigation to the session window: a click in the sidebar, or the return to it. A launch of Aether, a sidebar update and a window that stays open start nothing.
3. A window that stays open while the release closes its process does not start again by itself. The menu keeps the last list (S1 rule 7). The next Send, or the next open, starts it.
4. When the user leaves the window before the start is ready, Aether cancels that start. So clicking through sessions leaves no starts behind.
5. The start on open uses the same steps as a start for a message, in the same order (S9 rule 8): wait for a closing process, the S6 gate for each folder, then the start. No process and no token exist before the trust answer.
6. One start at a time for each session. A Send during a start on open waits for that start and uses its process. It never starts a second process or asks a second trust question. While the Send waits, the session shows "Starting Claude Code" as today.
7. During a start on open the transcript gets no "Starting" line and the composer stays ready. The menu shows its `loading` state (S1).
8. A start in progress is busy. The release never picks it: `retire-idle`, `Processes.retire` and the idle time ignore a session with a start record. An update that comes before `ready` does not set the idle time. The idle time starts at `ready`.
9. When a start on open is ready, Aether runs the rule of the idle limit, as at a turn end. So opening 8 sessions keeps at most 6 idle processes (B14).
10. Stop, Delete and quit cancel a start on open. Stop works also when the status is idle and no card is open. Quit waits for the start through `track`, so no process starts after quit.
11. A start on open that fails adds the same notice to the transcript as a failed start for a message (user decision, 2026-11-28: "Notice in the transcript"). This covers trust refused, not signed in, start failed, settings refused and the GitHub token notice.
12. A resume that fails on open starts a new agent session and shows the S4 notice "Aether could not continue the earlier conversation, so a new one starts." at once.
13. The notice of the Auto fallback (S7) shows at each process start, as today. A start on open is a process start.
14. A session whose folder no longer exists starts nothing on open and adds no notice. The next Send shows the folder error, as today.

## Screens

No new screen and no mockup.

| Moment | What the user sees |
|---|---|
| Open, start runs | The saved transcript. The composer is ready. `/` shows the last list or "Loading commands…". |
| Trust question needed | The trust dialog of S6, at once, over the window. |
| Start done | `/` shows the list of the agent. |
| Start failed, or trust refused | The notice of that failure at the end of the transcript, as after a Send. |
| Resume failed | The S4 notice. |

## Data

- No table, no column and no migration.

## Interfaces

- New command slice `sessions.start-agent` (`src/features/sessions/start-agent/`): input `{ id }`. It returns `accepted` at once. Error `unknown-session`. A draft, a session with a process or a start, and a missing folder give `ok` and start nothing. See open choice 3 for the trigger.
- New command `sessions.cancel-start`, or the leave signal of open choice 3, for rule 4.
- The start steps move out of `send-message.handler.ts` into a root file of the feature, `src/features/sessions/agent-start.ts`: `ensureProcess`, `startProcess`, `prepareStart` and the gate loop. Both slices import it. `send-message.handler.ts` keeps exporting `sendMessageHandler`, `SendMessageDeps` and `StartRequest`: the locked test `tests/architecture/m1-chat-s9-retire-idle.test.ts` imports them.
- `processes.store.ts`: a start record for each session (`beginStart`, `startOf`, `endStart`), with the flag `stopped` and the start promise. `retire`, `idleSince` and `releaseAll` respect it. Each new constructor argument is optional.
- `ensureProcess` takes a cancel record (a turn or a start record).
- `stop.handler.ts`, `delete.handler.ts` and the shutdown cancel a start record.
- `retire-idle.handler.ts`: the composition root calls it after a start on open is ready.
- `docs/architecture.md`, section Agents: "Aether can start the process when the user opens a session and starts to type" becomes "Aether starts the process when the user opens a session, or on intent on the New session page (decision 0015)."
- Decision 0015 holds rules 1 to 4 and 8 to 11, and the rejected alternatives of the brief.

## Terms

- "Start on open" in code comments and decision 0015. No new UI term.

## Error and empty states

See rules 11, 12 and 14.

## Locked tests of m1-chat that change meaning

The test author lists each one in the story PR, with the trailer `Locked-Test-Change: S2 starts the agent when a session opens (user decision 2026-11-28)`. Known today:

- `tests/acceptance/m1-chat/s7/directories.spec.ts` 152-163: the click on the session now opens the trust dialog before the user types.
- Any test that counts processes or `session/resume` after a click on a session.
- The reading of A22: an opened session now counts as an idle process.

## Checks

| Check | Given | When | Then | Test |
| --- | --- | --- | --- | --- |
| B9 | Brief | | One `session/resume` with the saved ID; no `session/prompt`. | Acceptance; live |
| B10 | Brief | | Cancel adds the notice "Aether did not start the agent in this repository." | Acceptance |
| B14 | Brief | | | Acceptance |
| S2-1 | A started session; its start on open waits at a gate | A Send through the bridge `invoke` path, as `s7/refusals` does | One process, one `session/resume`, one prompt. | Acceptance |
| S2-2 | A start on open waits at the trust dialog | A second `start-agent` and a Send through `invoke` | One dialog. After "Trust", one process. | Acceptance |
| S2-3 | A start on open waits at a gate | The user deletes the session | The start ends; no process and no dialog stay. | Acceptance |
| S2-4 | A profile without sign-in | The user opens a started session | "Claude Code is not signed in." shows once. | Acceptance |
| S2-5 | A window open, its process released | 1 minute passes (fake clock) | No new start. | Unit |
| S2-6 | A start on open waits at a gate | The user opens another session | The first start ends; no process of it stays. | Acceptance |
| S2-7 | A start that waits before `ready`; an update comes | The release runs | The start is not released. | Unit |
| S2-8 | A start on open waits at a gate | Aether quits | No agent process exists after quit. | Slice |

## Files and dependencies

- `src/features/sessions/agent-start.ts` (new, moved code), `start-agent/` (new), `send-message/send-message.handler.ts`, `processes.store.ts`, `stop/`, `delete/`, `retire-idle/`
- `src/app/contracts.ts`, `src/app/main/composition.ts`
- `src/renderer/src/App.tsx` or the navigation (S11 also changes `App.tsx`)
- `docs/decisions/0015-agent-start-on-open.md` (new), `docs/architecture.md`
- `tests/acceptance/m2-slash-menu/s2/` (new)
- S3 builds on `agent-start.ts` and the start record. S3 starts after S2 merges.

## Open choices

The user decided: a failed start on open adds the transcript notice (2026-11-28).

1. **Show a start on open.** A (recommended): no line and a ready composer; a Send that waits shows "Starting Claude Code". B: the status "Starting Claude Code" with Stop at each open.
2. **Notices that repeat at each open.** The GitHub token notice and the Auto fallback notice show at each process start.
   - A (recommended): keep them at each start, as for a Send. Impact: an open can add a notice.
   - B: show them at most once per process start that a Send caused. Impact: a special case in the start code.
3. **The open and leave signal.** M1 S11 adds `sessions.set-viewing`, which tells the main process which session the window shows.
   - A (recommended): when S11 merged, use `set-viewing` for rule 1 and rule 4. It also survives a reload of the renderer.
   - B: the new slices `start-agent` and `cancel-start`, called by the renderer.
