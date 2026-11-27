# S8 Plan widget: story spec

Status: draft for the design review. Not approved.

- Milestone: m1-chat.
- Check: A11, and the brief section "Plan widget".
- Mockup: [s8-plan-widget.mockup.html](s8-plan-widget.mockup.html).
- Locked tests: branch `story/m1-s8-plan-widget`, commits `0b60fa5` and `29466f3`, folder `tests/acceptance/m1-chat/s8/`. This spec follows their UI contract.
- Depends on: S4 (merged). Shares files with S5 and S7.

## Behavior

### Flow

1. The agent sends a `plan` update with all its steps.
2. `record-agent-update` passes it to `Transcript.addPlan`.
3. `addPlan` compares the step texts with the latest plan entry of the session.
   - Same texts, in the same order: this is progress. `addPlan` replaces the latest plan entry in place and sends `entry-replaced`.
   - Other texts, another number of steps, or no plan entry yet: this is a new plan. `addPlan` adds a new plan entry and sends `entry-added`.
   - In both cases, `addPlan` first closes the open text of the agent, as `updateTool` does. The locked Progress test sends text, a plan update, then text. Without this rule, the two texts join in one entry.
4. The renderer reads the latest plan entry of the snapshot. The plan widget shows it.
5. The transcript shows "Updated the plan" at each plan entry except the first one of the session.

### Rules

- The widget shows the latest plan entry of the session as a todo list.
- Each step shows one of three states:
  - pending: an empty circle
  - in progress: a spinner
  - completed: a check
- Each step also has its state as text: "Pending", "In progress" or "Completed". The text is visually hidden. The locked tests read it.
- The header shows "Plan N of M". N counts the completed steps. M counts all steps. Example: "Plan 1 of 3" for one completed step of three.
- The user can fold the widget. Folded, it shows the header with the count and hides the list.
- The widget stays after the turn ends. It stays until a new plan replaces it.
- A plan with no steps clears the plan. The widget does not show. This holds after a restart.
- The plan is a saved entry, so the widget shows the same plan after a restart.
- The widget sits in the bottom dock, below the transcript and above the composer. It is not inside the log "Transcript". Later entries come above it. The user decided this (open choice 3, option B).

### The session window frame

The user decided on 2026-11-27: "the text input for questions and chat should be anchored in the bottom of the feed." S8 builds the frame, because S8 owns "pinned" and runs before S5.

- The session window is a fixed frame with three parts:
  1. the header (title and facts) at the top
  2. the transcript, the only scroll area
  3. the bottom dock, always in view
- The bottom dock holds, from the top:
  1. the status line ("Starting Claude Code", "Working")
  2. the plan widget (S8)
  3. the permission queue (S5 adds it)
  4. the composer
- The trust and directory questions of S6 stay an app-level dialog (`QuestionDialog` in `App.tsx`). They are not cards in the dock.
- The status line keeps the S6 condition: no "Starting Claude Code" while `asking` is true.
- The header keeps the title, the facts (profile, folder, model, mode) and the button "Delete session" (brief, Session window; `s3/sessions.spec.ts` 117).
- The transcript scrolls under the dock. It stays at the bottom while new entries and streamed text arrive.
- When the user scrolls up, the transcript keeps the position of the user. When the user scrolls back to the bottom, it follows new entries again.
- The dock itself never scrolls. The composer is always fully in view.
  - Only the parts above the composer can scroll inside, each in its own area: the list of the plan widget and the permission queue.
  - The dock has no scroll offset when the locked place check of `s8/fixture.ts` (128-134) runs.
- A draft session uses the same frame. Its dock holds only the composer.

#### Conditions for the locked tests

- The element with the role `log` and the name "Transcript" is the scroll element itself. A wrapper around it must not scroll. Reason: the locked test compares the box of the log with the box of the widget.
- `.content` (`styles.css` 127-131) stops scrolling for the session page. Otherwise the page scrolls, and the frame fails.
- The log always has a height above zero, also with no entries.
- "Prompt" stays a `<textarea>`. The tests use `toHaveValue`.
- The visible text of the Mode button is exactly the mode label, for example "Ask". The arrow is an icon with `aria-hidden`. The S3 check `expectMode` uses `toHaveText`.

#### CSS Modules

- `docs/architecture.md` (282) says that new slices use CSS Modules.
- The new components of S8 (`PlanWidget.tsx` and the dock) use a CSS Module.
- The frame changes existing global rules (`.page`, `.content`, `.composer`, `.transcript`, `.error-notice`) in `styles.css`. These rules stay global, because other pages share them.
- `docs/architecture.md` 282 also says that the composer stays as it is. The user changed the composer of the session window on 2026-11-27. S8 updates that sentence.

### The composer

The user decided on 2026-11-27: the composer of the session window follows the composer of the GitHub app. This replaces the slim composer of commit `357d125`. S8 builds it with the frame.

- The composer stays at the bottom of the dock.
- It is one rounded box.
- The text area "Prompt" is at least 2 lines high, with the placeholder "Reply to Claude" inside.
- The text area grows with its content, up to `COMPOSER_MAX_LINES` lines. Above that, it scrolls inside.
  - Define `COMPOSER_MAX_LINES = 8` in one place in the renderer.
- A control row sits inside the box, at its bottom.
  - At the left, in this order:
    1. A small "+" button. Its accessible name is "Add context". It is disabled and shows "Coming soon", because a running session takes no new attachment in m1.
    2. The Mode control, as a small text-only button with no border. It keeps the accessible name "Mode". After the first message it is disabled, as in S3.
    3. The model of the session, as a small text-only button with no border. It is disabled, because the model is fixed once the session starts.
  - At the right: the small round button "Send". It shows as "Stop" during a turn.
- No mic button. Voice input is outside m1 (brief, Non-goals).
- The session window has no row below the box. The folder and the account are fixed once the session starts.
- The composer of a new session keeps its row below the box. It does not change in S8.
- The status line stays in the dock, above the plan widget.
- The accessible names stay: "Prompt", "Send", "Stop", "Mode" and "Add context". The locked tests of S3, S4 and S8 find the controls by these names.
- Enter sends, and Shift+Enter adds a line, as today.

### Failed turns in the transcript

The user decided on 2026-11-27, as part of the frame:

- A failed turn shows as one muted line with an info icon, at its point in the transcript.
- The style follows the reference "Execution failed: Model … is not available".
- Today S4 shows such a notice in the danger color. S8 changes only its look.
- The line keeps the role `alert` and the texts of S4 and S7. The S4 tests find "Claude Code is not signed in." and "exit code <n>" in an `alert`.
- An info notice, such as "Stopped.", does not change.

### More rules of the widget

- Aether ignores the priority of a step.
- The spinner stops when the system asks for reduced motion, like the other spinners of the app.

### States

| State | What the user sees |
|---|---|
| No plan entry | No widget. Today's screen. |
| A plan, unfolded | The header "Plan N of M" and the list of steps. |
| A plan, folded | Only the header "Plan N of M". |
| All steps completed | "Plan M of M". Each step shows a check. The widget stays. |
| A new plan | The widget shows only the new plan. The transcript shows "Updated the plan" at that point. |
| An empty plan | No widget. The transcript shows "Updated the plan" at that point. |
| Waiting | The widget does not wait for anything. Each event updates it at once. |

### Checks

| ID | Check | Level | Test |
|---|---|---|---|
| A11 | A plan with 3 steps, then step 1 completed and step 2 in progress: "Plan 1 of 3" with the three states, and the same after a restart. | Acceptance | `plan-widget.spec.ts`, first test |
| S8-1 | The widget is outside the transcript, below it, above the composer. A later reply comes above it. | Acceptance | `plan-widget.spec.ts`, second test |
| S8-2 | The widget stays after the turn. The user folds and unfolds it. | Acceptance | `plan-widget.spec.ts`, third test |
| S8-3 | A new plan replaces the old one and adds one "Updated the plan" at its point. | Acceptance | `plan-updates.spec.ts`, first test |
| S8-4 | A change of the step states only adds no "Updated the plan", also after a restart. | Acceptance | `plan-updates.spec.ts`, second test |
| S8-5 | A plan with no steps clears the widget, also after a restart. | Acceptance | `plan-updates.spec.ts`, third test |

## Screens

See the mockup. It shows these states:

- the current screen, for comparison
- no plan (empty state)
- a plan during a turn (the loading state: one step in progress)
- a plan after the turn, folded and unfolded
- a new plan with the marker in the transcript
- all steps completed
- an empty plan
- a failed turn, as one muted line with an info icon
- the error state of the widget: none applies, and the mockup says why

Each state of the mockup shows the fixed frame.

Changes against the current screen:

- Changed: the session window is a fixed frame. The header stays at the top. Only the transcript scrolls. Today the whole page scrolls, with the composer.
- New: the bottom dock, always in view.
- Changed: the composer like the GitHub app. The text area is 2 to 8 lines high. The "+", Mode and model controls and the Send button sit in a row inside the box, at its bottom.
- Changed: a failed turn shows as one muted line with an info icon. It keeps the role `alert`.
- New: the plan widget in the dock, between the status line and the permission queue (S5).
- Changed: the transcript shows no "Updated the plan" for the first plan of a session. Today S4 shows it for each plan update.
- Changed: a progress update no longer adds a line "Updated the plan".

Order in the session window, from the top. The S5 mockup uses the same order.

1. Header and facts (fixed)
2. Transcript (the only scroll area)
3. Bottom dock:
   1. Status line
   2. Plan widget (S8)
   3. Permission queue (S5)
   4. Composer

### UI contract of the locked tests

The builder must meet each item. The fixture `tests/acceptance/m1-chat/s8/fixture.ts` describes them.

- The widget is an element with the role `region` and the exact name "Plan". Use `aria-label="Plan"`. The visible header says "Plan 1 of 3".
- It is not inside the element with the role `log` and the name "Transcript".
- Its box starts below the end of the box of the transcript, and ends above the text field "Prompt".
  - With the frame, this holds only when the log element is the scroll area. Then its box ends at the top of the dock.
  - If a wrapper scrolls and the log grows to its full height, the box of the log ends below the widget, and the test fails.
  - Playwright counts an entry that is scrolled out of the log as visible, so the text checks of the transcript still pass.
- It has one `list` with one `listitem` for each step, in the order of the agent.
- Each item holds its step text and its state text. It holds no other state text.
- Only the item in progress runs an animation. The tests ask for full motion.
- It has exactly one button with `aria-expanded`. "true" shows the list. A click hides the list and sets "false". The count stays visible.
- The transcript shows the exact text "Updated the plan" for a new plan. Progress adds none.
- The widget does not exist (count 0) when the latest plan has no steps.

## Data

- No migration. No new column. No change of the entry schema.
- A plan entry stays `{ kind: 'plan', steps: [{ text, status }] }` (migration 002, `entry.ts`).
- The write rule changes. Today each plan update adds a new entry. After S8, a progress update replaces the latest plan entry in place. A new plan still adds an entry.
- The entry keeps its ID and its position when it is replaced. So the transcript keeps the marker at the point of the plan.
- The step texts compare as exact strings, in order.
- The comparison uses the latest plan entry of the session, also from an earlier turn.
- Entries that S4 saved on the milestone branch stay valid. Old progress entries then show as extra markers. No user data exists yet, because m1 is not released.

## Interfaces

- No new contract, IPC name or event.
- The renderer derives the widget from the entries of the `sessions.open` snapshot and the `sessions.changed` events that exist.
- `Transcript.addPlan` (main) needs one store query: the latest plan entry of a session. `SessionStore` gets a method such as `latestPlan(sessionId)`.
- A pure function decides "same plan": `isSamePlan(previous, next)`, in `src/features/sessions/entry.ts`.
- A pure renderer function finds the latest plan and counts the completed steps, for example in `src/renderer/src/session-view.ts`.

## Terms

| Thing | UI | Code | Database |
|---|---|---|---|
| The widget | "Plan" (region name), "Plan N of M" (header) | `PlanWidget` | none |
| A step | the text of the agent | step | `steps[]` in `entries.data` |
| The states | "Pending", "In progress", "Completed" | `pending`, `in_progress`, `completed` | same as code |
| The marker | "Updated the plan" | plan marker | none |
| A progress update | none | progress | none |

## Error and empty states

| Case | Behavior |
|---|---|
| The session has no plan entry | No widget. |
| The latest plan has no steps | No widget. The transcript shows the marker, except for the first plan. |
| A plan with one step | "Plan 0 of 1" or "Plan 1 of 1". |
| A very long step text | The text wraps. The widget has a maximum height and scrolls inside when the plan is long. |
| A plan entry fails the schema on read | S4 already handles it: the read of the entries fails as a defect. S8 adds nothing. |
| Error state of the widget | None applies. The widget has no command and no load of its own. It shows the data of the snapshot. |
| Loading state of the widget | None applies. The snapshot holds the entries. A step in progress shows a spinner. |

## Files and dependencies

### Files

- `src/features/sessions/transcript.store.ts`: `addPlan` replaces or adds. Shared with S5.
- `src/features/sessions/entry.ts`: `isSamePlan`, and the comment of `planEntry`. Shared with S5 and S7.
- `src/features/sessions/session.store.ts`: the query of the latest plan entry.
- `src/features/sessions/transcript.store.test.ts`, `entry.test.ts`: unit tests.
- `src/renderer/src/components/Transcript.tsx`: the marker rule. The log element becomes the scroll area, and it keeps its scroll at the bottom.
- New `src/renderer/src/components/PlanWidget.tsx`.
- `src/renderer/src/components/SessionPage.tsx`: the fixed frame (header, transcript, bottom dock), the place of the widget in the dock, and the composer with its control row inside the box. Shared with S5 and S6.
- `src/renderer/src/components/ModeMenu.tsx`: a text-only look with no border for the control row, if its style needs a variant. Its accessible name stays "Mode".
- `src/renderer/src/components/Transcript.tsx` and `styles.css`: the muted line with an info icon for an error notice. The role `alert` stays.
- `COMPOSER_MAX_LINES` in the renderer, for example in `SessionPage.tsx` or a small composer module.
- `src/renderer/src/session-view.ts`: the latest plan and the count.
- `src/renderer/src/styles.css`: the global rules of the frame (`.page`, `.content`, `.composer`, `.transcript`, `.error-notice`). The old `.plan` rules can go. Shared with S5.
- New CSS Modules for `PlanWidget.tsx` and the dock. See "CSS Modules".
- `docs/architecture.md`: the sentence of line 282 that the composer stays as it is.
- The layout around the page (the main area of `App.tsx`) may need a fixed height for the frame. Shared with S6.

### Dependencies

- Needs: S4 (merged).
- No dependency on S5, S6, S7 or S9. S8 does not touch the agent process code.
- S8 builds the frame and the bottom dock. S5 needs S8 merged, and then adds its queue to the dock. This changes the plan: S5 depended on S4 only.
- S5 and S8 both change `SessionPage.tsx`, `transcript.store.ts` and `styles.css`. They merge one at a time, S8 first.
- S6 is merged (`50bd85a`). Its questions stay an app-level dialog. S8 keeps its `asking` condition on the status line.

## Conflicts between the locked tests and the brief

No test contradicts the brief. The tests settle five points that the brief leaves open. The coordinator reports them in the design review.

1. "New plan" has no definition in the brief. The tests say: the same step texts with new states are progress, not a new plan. The S4 code marks each plan update, so the builder changes the S4 write rule.
2. The brief does not cover an empty plan. The tests say: a plan with no steps hides the widget. The brief says "It stays after the turn ends". That sentence covers a turn end, not an empty plan, so the two agree.
3. The brief gives icons only. The tests also require a state text in each step: "Pending", "In progress", "Completed". It can be visually hidden.
4. The brief says "pinned above the composer". The tests check the place only: below the transcript and above the composer. They do not check a sticky dock. The user chose the dock (open choice 3). The tests still hold, if the log element is the scroll area. See "UI contract of the locked tests".
5. The brief says the transcript shows "Updated the plan" when a new plan replaces the old one. The tests do not decide the first plan of a session. See open choice 2.

The count agrees with A11: "Plan 1 of 3" counts the completed steps. The brief example "Plan 2 of 5" fits this reading.

## Open choices

The advisor answered each choice. Its answer is recorded under the choice.

### 1. Progress or new plan

- User column: no. The saved format does not change.
- Hard to revert: no. No migration.
- Options:
  - A. Decide in `Transcript.addPlan`. Same texts in the same order replace the latest plan entry in place. Impact: one entry for each plan; the restart needs no second rule; the entry history of the progress is lost.
  - B. Add an entry for each update. The renderer hides the marker for progress. Impact: the full history stays; the renderer repeats the rule; the entries table grows with each update.
- Recommendation: A. Record that this changes the S4 write rule.
- Advisor: A. The user likely agrees.

### 2. The marker for the first plan

- User column: no.
- Hard to revert: no.
- Options:
  - A. No marker for the first plan entry of the session. A marker for each later plan entry. Impact: follows the brief wording "replaces the old one"; the transcript has no trace of the first plan, but the widget shows it.
  - B. "Updated the plan" for each plan entry. Impact: one simple rule, as in S4; the first plan says "Updated" although nothing was updated.
  - C. A second text, "Made a plan", for the first plan. Impact: a new UI term for the user to approve.
- Recommendation: A. An empty plan also gets the marker, with no new text.
- Advisor: A. The user likely agrees.

### 3. "Pinned": placement or a sticky dock

- **Decided by the user on 2026-11-27: option B.** The user said: "the text input for questions and chat should be anchored in the bottom of the feed."
- S8 builds the frame. S5 adds its queue to the dock. See "The session window frame".
- User column: no, until the user decided it. It is now an approved hot item. A change of it goes to the user.
- Hard to revert: no. A later change is in the layout only.
- Options as they were offered:
  - A. Placement in the flow of the page. The widget comes after the transcript, and the page scrolls as today. Impact: matches the locked tests and the current page; with a long transcript, the widget and the composer scroll with the page.
  - B. A sticky dock. The transcript scrolls inside its own area. The plan widget, the permission queue and the composer stay at the bottom of the window. Impact: like the Claude desktop app; a layout change that also moves the S5 queue; the log "Transcript" must become the scroll area, or the locked test of the place fails.
- Earlier recommendation: A in S8. The advisor also said A, and predicted that the user may expect the dock of the Claude desktop app. The user chose B.

### 4. The fold state

- User column: no.
- Hard to revert: no.
- Options:
  - A. View state of the renderer. Each open of the session window starts unfolded. A new plan keeps the fold state. Impact: no saved data.
  - B. Save the fold state for each session. Impact: a new saved value for the user to approve.
- Recommendation: A.
- Advisor: A. The user likely agrees.
