# S5 Permission queue: story spec

Status: Approved by the user in the design review on 2026-11-27 (PR #31). The tests are locked. The builder follows this spec.

- Milestone: m1-chat. Path step 6.
- Checks: A4, A5.
- Defect fixed: "Aether cancels each permission request, so a tool that needs a question fails" (`docs/architecture.md`, Known defects).
- Mockup: [s5-permission-queue.mockup.html](s5-permission-queue.mockup.html).
- Depends on: S4 (merged), S7 (the port update `mode`) and S8 (the scroll element, the follow rule and the status line). Shares files with S6, S7, S8 and S9. See "Files and dependencies".

## Behavior

### Flow

1. The agent sends `session/request_permission`, during a turn or outside one (see "Requests outside a turn").
2. `providers/acp` gives the request an Aether ID and keeps it open.
3. `providers/acp` tells the session slice through the agent listener.
4. The main process adds the request to the queue of the session and sends a `sessions.changed` event.
5. The session window shows one permission card for each open request, oldest first.
6. The user clicks one option on a card.
7. The renderer calls `sessions.answer-permission` with the session ID, the request ID and the option ID.
8. The main process checks the request and the option, then answers the agent for that request only.
9. The card closes. The other cards stay.

### Rules

- Each request has its own ID. An answer names the ID. An answer never reaches another request.
- The queue shows the requests in the order of arrival. The oldest request is at the top.
- The user can answer the cards in any order.
- Stop cancels all requests of the session:
  1. The provider sends `session/cancel`.
  2. The provider answers each open request with `cancelled`.
  3. Each card closes.
- The agent can cancel one request itself (`$/cancel_request`). Then only that card closes.
- A request closes one time only. When Stop and a cancel of the agent arrive together, the agent gets one answer and the window gets one `card-closed`.
- A process exit, a crash and the deletion of the session close the cards.
- The end of a turn does not close a card. The agent cancels a request that it no longer waits for.
- The queue lives in memory only. It does not survive a restart of Aether (`docs/architecture.md`, Agents).
- The main process accepts an answer only for an open request of that session, and only with an option that the request offered.
- A request that comes after Stop, while the cancel of that turn runs, or while the process closes (a release, a delete or a quit), gets `cancelled` at once. It shows no card.

### Requests outside a turn

- Claude can start a model cycle after the prompt resolved (`v1/acp-agent.js` 3299, 6692-6712). An example is the wake-up after a background task.
- So updates, and possibly permission requests, can come when Aether has no turn for the session.
- S5 shows such a request as a card, like a request during a turn. See open choice 9.
- While a card is open, the status line says "Waiting for your answer", and Stop shows.
- Stop with no turn cancels each open request of the session. `stop.handler.ts` changes for this: today it does nothing when the status is idle.
- An open card keeps the session busy for S9. See the S9 spec.
- The renderer cannot grant a permission without a request. A compromised renderer can still answer an open request. `docs/architecture.md` accepts this risk.

### States

| State | What the user sees |
|---|---|
| Working, queue empty | Today's screen: the transcript and "Working". |
| Waiting for permission | One card for each open request, in the transcript where Claude asked. The status line says "Waiting for your answer". Stop is available. This holds with any status, also outside a turn. |
| Answer sent | The card switches at once to its answered layout, with a small spinner after the chosen label. No disabled buttons show. |
| Answer refused by the main process | The card stays. It shows the reason under its buttons. The buttons work again. |
| After Stop | No open card. Each card that was open stays as a not-answered card: the question in the secondary color, and "Not answered: you pressed Stop." in the primary color. The transcript shows "Stopped." The open tool calls show "Failed". The composer is ready. |

The session status does not get a new value. "Waiting for permission" is any status with a queue that is not empty. See open choice 3.

- While a card is open, the composer shows Stop, not Send.
- `sessions.send-message` refuses a message while a card is open, with the existing error `turn-active`. The user answers the card or clicks Stop first.

### Checks

| ID | Check | Level |
|---|---|---|
| A4 | The agent asks two permissions at the same time. The user allows the first and refuses the second. Both cards show. The agent receives each answer for its own request. (live) | Acceptance |
| A5 | Two open requests. The user clicks Stop. Both cards show as not answered, with the reason "Not answered: you pressed Stop.". The agent receives `cancelled` for both. | Acceptance |
| S5-1 | The user answers the second card first. Each request gets its own answer. | Acceptance |
| S5-2 | The agent cancels one of two requests. Only that card closes. | Slice |
| S5-3 | An answer with an unknown request ID, or with an option that the request did not offer, fails. The agent gets nothing. | Slice |
| S5-4 | The agent process exits while two requests are open. Both cards close. | Slice |
| S5-5 | A request comes when no turn runs. A card shows. Stop cancels it, and the agent receives `cancelled`. | Slice |
| S5-6 | A safety ask with "No" first. "No" is the first and the primary button. In another request, the first `allow-once` option is first and primary. | Acceptance |
| S5-7 | The agent reports the mode `accept-edits` after a plan exit. The Mode control shows "Accept edits". After a restart, the session starts in `accept-edits`. | Acceptance |
| S5-8 | The agent reports `bypassPermissions`. The Mode control shows "Approve all". The saved mode stays the last saved mode. A new process starts in that mode. | Slice |
| S5-9 | `initialize` declares form elicitation. The agent sends a single select question. The card shows one radio row for each option, in the order of the agent, with its explanation. A row click and "Submit" send `accept` with that `const`. | Acceptance |
| S5-10 | A multi select question with "Other": the user checks two option rows and the "Other" row, types a text and submits. The agent receives the array and the custom text. | Acceptance |
| S5-11 | "Skip" sends `decline`. Stop sends `cancel` for an open question card. | Slice |
| S5-12 | A form with a number field gets the error -32602, and no card shows. | Slice |

| S5-13 | A session folder under R, in a Git repository whose root holds R, and a second case where the root equals R. The trust question shows the facts "Repository" and "Repository root", and the warning that names R and the profile. | Acceptance |
| S5-15 | The refusal fallback dialog shows "Keep the refusal" first and primary. "Retry with <fallback>" sends `accept`. The agent reports the new model. The model button shows it, and after a restart the session starts with it. | Acceptance |
| S5-16 | The agent reports `acceptEdits` with the S7 notice for the fallback of Auto. The Mode control shows "Accept edits". The saved mode stays `auto`, and the notice shows again at the next start. | Slice |
| S5-17 | Two open cards show inside the log "Transcript", at the place where they arrived, in the order of arrival. A later entry comes after them. The dock holds no card. | Acceptance |
| S5-18 | The user scrolled up. A new card comes. The log does not move. The status line shows "Waiting for your answer" and "Show request". A click brings the oldest open card into view and focuses it. | Acceptance |
| S5-19 | A new card does not take the focus: a key typed in "Prompt" goes to the composer. | Acceptance |
| S5-20 | After the user picks "Allow", the decision card stays in the transcript with no buttons. It shows the question in the secondary color and "Allow" in the primary color. After a restart it shows the same. Stop on an open decision card shows "Not answered: you pressed Stop.". | Acceptance |
| S5-28 | Each path that closes an open card saves its reason: Stop (`stopped`), `$/cancel_request` (`withdrawn`), the exit or crash of the process (`exited`), the quit of Aether (`quit`), Skip (`skipped`). The card shows the text of its reason after a restart. Delete session saves no entry, and the agent gets `cancelled`. | Slice |
| S5-29 | Stop on a card makes the adapter also send `$/cancel_request`. The card keeps the reason `stopped`: the first close wins. | Slice |
| S5-30 | A card opens. Its `answers` entry is saved at once with the outcome `open`, and the renderer shows the live card, not the entry. The answer updates the same entry in place (same ID, same position). | Slice |
| S5-31 | Crash path: a card is open, and the test kills the main process of Aether. At the next start, before the window loads, the entry has the outcome `interrupted`. The card shows "Not answered: Aether stopped unexpectedly." and no button. | Acceptance |
| S5-27 | While an answer is being sent, the card shows no disabled button: it shows the answered layout with a spinner, and keeps the name "Permission request" (or "Claude asks"). When main accepts the answer, it becomes "Permission answered" (or "Claude asked"). When main refuses the answer, the card goes back to its buttons, with the error line. | Acceptance |
| S5-32 | The normal path never shows "Not answered: Aether stopped unexpectedly.": at open, the change `card-opened` carries the `open` entry and its request together; at close, `card-closed` carries the replaced entry and the request ID together. A test checks each event and the view after it. | Slice |
| S5-21 | The user answers a single select and a multi select with "Other". The card turns into the answered card "Claude asked", with one row for each question and the answer below it. After a restart it shows the same. | Acceptance |
| S5-22 | A question with no pick shows "Not answered: you skipped it.". Skip of the whole form shows "Not answered: you skipped it." in each row. Stop on an open question card shows "Not answered: you pressed Stop." in each row. | Acceptance |
| S5-23 | A click on an option row selects it and sends nothing. "Submit" is disabled until a pick or a text. No row is preselected. | Acceptance |
| S5-24 | A decision card with "Yes", "Yes, and don't ask again for …" and "No" shows the primary split button "Yes", its dropdown "More allow options" with the menuitem of the "always" option, and the button "No". The menuitem sends its option. A safety ask puts the refuse group first and primary. The card shows the context in the secondary color and the question in the primary color. | Acceptance |
| S5-26 | At a wide width, the buttons of a decision card sit on one line, each sized to its content. At a narrow width (375 px), each button takes the full width of the card, at equal size, stacked. | Acceptance |
| S5-25 | An MCP form with a text field saves "Answered", not the typed text. | Slice |
| S5-14 | A session folder in a repository inside R. The trust question shows the root path and no warning. | Acceptance |

S5-1 to S5-32 are not in the brief. They cover the rules above.

S5-31 needs a kill of the main process. No fixture has one today: the S4 fixture only has `chat.stop()`, a normal quit (a grep of `tests/acceptance`). The S5 test author adds a helper, for example `electronApp.process().kill()`, and on Windows also ends the simulated agent that the kill leaves behind.

The references to lines of the adapter (`v1/acp-agent.js` and others) in this spec come from the design review, not from the first read of this spec.

### Live mode (user decision, open choice 5)

- An option can change the mode of the agent: a plan exit approval, or the file edit option "Yes, allow all edits during this session".
- The agent then sends `current_mode_update`. S7 translates it into the port update `mode`.
- The Mode control shows this live mode at once.
- Aether saves the live mode in `sessions.mode`, so a new process starts in it. A release (S9) and a restart keep the mode that the user chose.
- Approve all (`approve-all`, Claude `bypassPermissions`) shows in the Mode control, but Aether never saves it. The session keeps its last saved mode. A new process then falls back to that mode. This follows the rule of decision 0012 for Approve all.
- The S7 notice for the fallback of Auto compares the reported mode with the asked mode. `record-agent-update` decides the notice first.
- Auto fallback (user decision B, 2026-11-27): when the reported mode comes with the S7 notice for the fallback of Auto, Aether shows the live mode but keeps `auto` saved. The notice then shows again at the next start, as decision 0012 and S9 rule 12 say.
- A new session copies the mode of the newest session (decision 0012). A saved live mode counts. Approve all is never copied, as before.
- After the first message, the user still cannot change the Mode control. Only the agent changes the mode.

### Questions of the agent (user decision, open choice 8)

Scope: S5 grows. Aether declares the ACP form elicitation capability. Claude's `AskUserQuestion` then works, and its questions show as cards inline in the transcript, like the permission cards.

#### Protocol facts for the builder

- Capability: `initialize` sends `clientCapabilities.elicitation = { form: {} }`. Do not declare `url`.
- With `form`, the Claude adapter (0.112.0) turns on these paths:
  - `AskUserQuestion` (`v1/acp-agent.js` 7886-7893)
  - MCP server elicitations of the mode form (`onElicitation`, 8040-8041)
  - the refusal fallback dialog: "<model> declined this request. Retry with <fallback>?" (8049-8053)
- Request: the agent sends `elicitation/create` (`methods.client.elicitation.create`) with:
  - `mode: "form"`, `sessionId`, an optional `toolCallId`, and `message` (the question text for one question)
  - `requestedSchema`: `{ type: "object", properties }`
- The schema of `AskUserQuestion` (`elicitation.js` 122-175):
  - `question_<n>`: one question. A single select is `{ type: "string", title, description, oneOf: [{ const, title, description }] }`. A multi select is `{ type: "array", title, description, items: { anyOf: [...] } }`.
  - `question_<n>_custom`: `{ type: "string", title: "Other", description }`, the free text of that question. It is always there and optional.
  - No field is required.
- Answer (`CreateElicitationResponse`):
  - Submit: `{ action: "accept", content: { question_0: "<option const>", question_0_custom: "<text>" } }`. A multi select sends an array of `const` values.
  - Skip: `{ action: "decline" }`. Claude gets empty answers and continues. It is told that the user skipped.
  - Stop, the end of the process, or the cancel of the agent: `{ action: "cancel" }`. The tool call aborts.
- The agent can withdraw the request with `$/cancel_request`, as for a permission request. Then the card closes.
- A form that Aether cannot render gets the JSON-RPC error -32602. The adapter then answers an MCP server with `cancel` and denies `AskUserQuestion` with "Could not present the question to the user." (`answerMcpElicitation` and `answerAskUserQuestion` in `elicitation.js`).

#### What Aether renders

- Aether renders these field types only:
  - a string with `oneOf`: a single select
  - an array with `items.anyOf`: a multi select
  - a plain string: a text field, for example "Other"
- Any other field (number, integer, boolean, a string with `format` or `enum`) makes the whole form unsupported. Aether answers -32602.
- MCP elicitations: a form of an MCP server that uses only the three field types renders on the same path, at no extra cost. Each other MCP form gets -32602, so the MCP server receives `cancel`. URL elicitations stay off.
- The refusal fallback dialog is one single select, so it renders on the same path. Its options are "Retry with <fallback>" and "Keep the refusal".
- Refusal fallback (user decision A, 2026-11-27):
  - "Keep the refusal" is first and primary. It is the default of the adapter (`refusalFallbackResultFromResponse` in `elicitation.js`).
  - The general rule would make the first option of the adapter, "Retry with <fallback>", primary. So Aether must know this dialog:
    - The form has one field with the key `choice`, and its option values are `retry_fallback` and `cancelled` (`elicitation.js` 339-375).
    - The `providers/claude-code` recipe holds this rule, not `providers/acp`: a recipe function picks the recommended option of an elicitation. For this form it returns `cancelled`, and Aether shows that option first.
  - When the user picks "Retry with <fallback>", the adapter switches the model with `syncModelAfterExternalSwitch` (`v1/acp-agent.js` 4028 and 7599-7611). It then sends `config_option_update` with the full list `configOptions` (`updateConfigOption`, 7435-7439).
  - The adapter sends `config_option_update` from other places too. S7 does not translate it (checked on `story/m1-s7-settings`).
  - `providers/acp` keeps the value of the option `model` from the response of `session/new` or `session/resume` as the base, after `ready`.
  - It reports the port update `{ type: "model", model }` only when a later `config_option_update` carries another value of the option `model`. So a session saved as `default` is not overwritten by the concrete ID of the default model.
  - Aether shows the new model in the model button, and saves it in `sessions.model`. A restart or a release then keeps it.
  - This is the one case where the model changes after the first message.
  - A new process can refuse the saved fallback model. Then the start fails with the S4 notice of `settings-refused`, as for any refused model. The model button stays disabled, because the session is not a draft. The user can start a new session.

#### The question card (user decision, 2026-11-27)

The user said: "For ask question tool, We should Claude design, where each option is like options (radio button) and each option has the option text and a sub text that can contain explanations. They have their own row and clicking or tapping in the row selects it. It can have radios or checks. Radios for single option and checks for multiple choices! Buttons as shown in the image should be used for other more binary cases, I can't recall a situation where Claude showed more the 2 buttons in a card it is often 2 or 1 only."

- The open card is an `article` with the fixed name "Claude asks".
- The question text: the `message` for one question. In a form with several questions, the field `description` is the question text, and the field `title` is only a small header above it (`elicitation.js` 145-146, 171).
- Each option is a full-width row, split from the next row by a separator.
  - A single select uses a radio in each row. The rows form a `radiogroup` with `radio` items.
  - A multi select uses a checkbox in each row. The rows form a `group` with `checkbox` items.
  - The row shows the option label in the primary text color, and its explanation below it in the secondary color.
  - The explanation is the option `description`. It reaches Aether: the adapter copies `option.description` into the `description` of each `oneOf` or `anyOf` item, and ACP version 1 has this field (`EnumOption`). Only the `preview` in `_meta` is lost, which S5 does not render.
  - A click or a tap anywhere on the row selects it. A row click only selects. It never sends.
  - The accessible name of a row is the option label only. The explanation is its description (`aria-describedby`).
- "Other" is the last row of each question. It is a radio row in a single select, and a checkbox row in a multi select. It holds a one-line text field. Aether sends the text as `question_<n>_custom` only when the "Other" row is selected. The adapter reads a pick plus a text as a note.
- The recommended option:
  - Assumption: Claude Code puts its recommended option first and adds "(Recommended)" to its label. This read found no such rule in the adapter, so it is a convention of Claude, not a field of ACP.
  - Aether keeps the order of the agent. So the recommended option comes first.
  - No row is preselected. Submit would otherwise send an answer that the user did not pick, and the answered card would save it as the answer of the user. The advisor predicts no clear user preference, so this is a hot item.
- Several questions in one form: one block for each question, with its header, its question text and its rows. Separators split the blocks.
- Below the rows, at most two compact buttons:
  - "Submit" (primary). It sends `accept` with the picks and the texts. It is disabled until at least one question has a pick or a text.
  - "Skip" (plain). It sends `decline`.
- Stop sends `cancel`.
- The card follows the rules of a decision card: oldest first, one answer only, no disabled buttons, the answered layout with a spinner while the answer is sent, and the error line on a refusal.
- The refusal fallback is the binary case of decision A. It keeps its two buttons: "Keep the refusal" (primary) and "Retry with <fallback>".

#### The answered card (user decision, 2026-11-27)

The user said: "On Claude desktop the card changes and shows a list with the question and the answer. I would follow this pattern. Each question in primary, answers in secondary, and both in their own row inside the card. When multiple questions and answers we have separators between each row delimiting their space."

- After Submit, Skip or a cancel, the question card turns into an answered card. It does not disappear.
- The answered card is an `article` with the fixed name "Claude asked". It does not reuse "Claude asks", so a locator for an open card never matches an answered card.
- It lists one row for each question: the question text in the secondary color, and the answer or the reason below it in the primary color (user decision, 2026-11-27). Separators split the rows.
- The answer text:
  - submitted: the picked labels, joined with ", ", then the typed text of "Other"
  - a question with no pick and no text: "Not answered: you skipped it."
  - Skip of the whole form: each row says "Not answered: you skipped it."
  - a close without an answer: each row says why. See "Cards that closed without an answer".
- The refusal fallback card also turns into an answered card, with the one row "Retry with <fallback>?" and the chosen option.
- The answered card is a saved entry, so it stays after a reload and a restart. See "Data".
- The entry is saved when the card opens, and updated in place when the card closes. See "Data". So the answered card keeps the place where the card opened.
- Which closes save an entry: see "Cards that closed without an answer".
- A form that got -32602 saves nothing, because no card showed.
- Decision cards (permission cards) also stay after the answer. See "The answered decision card".

#### The answered decision card (user decision, 2026-11-27)

The user said: "when we have already answered we shouldn't show the button disabled. We show only the question in secondary and the answer in primary inside the card."

- After an answer, the decision card stays in the transcript, at its place. It drops its buttons. No disabled button shows.
- It shows only the question in the secondary color, and the chosen answer (the label of Claude's option) in the primary color.
- A close without an answer shows why. See "Cards that closed without an answer".
- The button "Cancel request" of a request with no options is an answer of the user. It saves `submitted` with the label "Cancel request".

#### Cards that closed without an answer (user decision, 2026-11-27)

The user said: "we should show a card with the question in secondary and something telling that the session was canceled/exited or the question was dismissed. What I'm trying to convey is that if the session had a question that was not answered we should make clear that it was not answered and why it was not answered."

- A decision card or a question card that closed without an answer stays in the transcript.
- It shows the question in the secondary color, and in the primary color a line that says it was not answered and why. For a question card with several questions, each row shows the line.
- The reasons and their texts (the advisor answered; in the skim list):

| Reason (`outcome`) | Cause | Text |
|---|---|---|
| `stopped` | The user pressed Stop. | "Not answered: you pressed Stop." |
| `withdrawn` | Claude withdrew the request (`$/cancel_request`). | "Not answered: Claude withdrew it." |
| `exited` | Claude Code exited or crashed. | "Not answered: Claude Code exited." |
| `quit` | Aether quit, and closed the process. | "Not answered: Aether closed." |
| `interrupted` | Aether stopped unexpectedly (a crash or a kill), set at the next start. | "Not answered: Aether stopped unexpectedly." |
| `skipped` | The user skipped a question, or left it empty in a submitted form. | "Not answered: you skipped it." |

- No reason `released`: a release (S9) never closes a shown card. S9 releases only an idle session, with no open card, and the idle check and the start of the close are one synchronous step. A request that comes while the process closes gets `cancelled` at once, with no card. See the S9 spec.
- Delete session saves no entry, because the entries go with the session. The agent still gets `cancelled`.

Who names the reason:

- The slice that starts the close names its reason. Stop gives `stopped`. The quit path gives `quit`.
- One rule for the provider: `cancel()` and `close()` report nothing. Only a withdraw or an exit that the slice did not start reports `withdrawn` (the signal of the request) or `exited` (the process ended by itself), in `permissionClosed(id, reason)` and `elicitationClosed(id, reason)`.
- The first close wins. Stop also makes the adapter send `$/cancel_request`, and a quit makes the process exit. The slice saves its reason before it calls `cancel()` or `close()`. A later close of the same card changes nothing.
- Quit order: the quit path updates the entries of the open cards to `quit` first, then calls `processes.releaseAll()`, and only then the database closes (`composition.ts` 191-193 on `milestone/m1-chat`).
- A crash or a kill of Aether (user decision, 2026-11-27). The user chose: "Save the card when it opens; at the next start an open one shows 'Not answered: Aether stopped unexpectedly.'"
  - The entry of each card is saved when the card opens, with the outcome `open`. See "Data".
  - At the next start, before any window loads, Aether changes each `open` entry to the outcome `interrupted`.
  - The card then shows "Not answered: Aether stopped unexpectedly.", with no button.
- It is an `article` with the fixed name "Permission answered". It does not reuse "Permission request", so a locator for an open card never matches it.
- It is a saved entry of the approved kind `answers`, with one row. A reload or a restart keeps it. See "Data".
- While the answer is being sent, the card shows the answered layout at once, with a small spinner after the chosen label. It keeps its name "Permission request" (or "Claude asks") until main accepts the answer. Then it becomes "Permission answered" (or "Claude asked"), the spinner goes, and the entry is replaced in place. When main refuses the answer, the card goes back to its buttons and shows the error line.
- The same rule applies to the question cards: no disabled button while "Submit" or "Skip" is sent. The card shows its answered layout with a spinner.
- Color order (user decision, 2026-11-27): every answered or not-answered card shows the question in the secondary color and the answer or the reason in the primary color. This holds for decision cards, question cards, and each row of a form.

#### Decision cards (user decision, 2026-11-27)

The UI spec now calls a permission card a "decision card". The user rejected the radio rows and "Confirm" for permission cards. The user said: "My rule was too aggressive. I didn't want to mean that we shouldn't have a card with 3 buttons, what I tried to convey was that the ask question tool for Claude is a different tool for when he shows the button. The ask question tool has the questions and options for that question. The options have their text and an explanation text. The card with button (I don't know the name Claude gives to it, so I will call a decision card) often has 1 or 2 buttons. You can confirm this, but as long as I remember it has a context in secondary and a question in primary. So for decisions we don't need explanation by options while for questions we have an explanation by each option. For the decision card I would allow the buttons to have different sizes only when they're on a screen size that allows them to be shown in a single line, in cases where they break the line I would make them have the same size and occupy the whole line. Eg. Mobile screens. I would also group options with the same meaning under a dropdown button, like yes, yes + something else 1, yes + something else 2 are all yes options, so I would have the recommended selected and the other options under the dropdown."

Layout:

- The context in the secondary color: the tool kind and the tool title, for example "execute · npm test", and the locations (paths), when the request has them.
- The question in the primary color, for example "Run this command?".
- Then the buttons. Buttons have no explanation text.

Fact and reading:

- Fact: over ACP version 1, the request of the Claude adapter carries `toolCallId`, `title` and `rawInput`, and no question text. The heading and the explanation of the prompt go only to AIR in `_meta`, and to an ACP version 2 client as `title` and `description` (`permissions/presentation.js`).
- Fact: the Claude adapter often offers three options: the fallback tools and WebFetch use `withGeneratedUpdate` ("Yes", "Yes, and don't ask again for …", "No"), and the plan exit has four or five. With the groups, such a card shows one split button and one plain button: two buttons, as the user remembers.
- Fact: this read did not check the Claude desktop app. The layout "context in secondary, question in primary" is the memory of the user. This spec follows it.
- Reading: Aether writes the question text from the tool kind. These are new Aether texts, in the skim list:
  - `execute`: "Run this command?"
  - `edit`, `delete`, `move`: "Make this change?"
  - `read`, `search`: "Read this?"
  - `fetch`: "Fetch this?"
  - `switch_mode` (the plan exit): "Approve the plan?"
  - any other kind: "Allow this tool?"

Groups by meaning:

- All allow options (`allow-once` and `allow-always`, the plan exit variants included) form one group. All refuse options form another group.
- A group with two or more options is a split button:
  - The main part is the recommended option of the group, with its label from Claude.
  - A dropdown part holds the other options of the group, with their labels from Claude, in the order of the agent.
- A group with one option is a plain button.
- The recommended option of the allow group is its first `allow-once` option. Without one, it is the first allow option of the agent.
- The recommended option of the refuse group is its first option.
- Primary and order:
  - The allow group comes first and is primary. Example: the split button "Yes" with the dropdown "Yes, and don't ask again for npm test commands", then the button "No".
  - On a safety ask, where the first option of the agent is a refuse option, the refuse group comes first and is primary (open choice 7).
- Example, plan exit: the split button "Yes, manually approve edits" with the dropdown "Yes, and use auto mode" and "Yes, and bypass permissions", then the button "No, keep planning".

Sizing:

- While all buttons fit on one line, each button sizes to its content.
- When they would wrap, for example on a narrow or a mobile width, each button takes the full width of the card, at equal size, stacked. A split button keeps its dropdown part at its right end.
- The builder uses a container query or a measure of the line, not a fixed screen width.

Accessibility:

- The card stays an `article` with the fixed name "Permission request". So the tests keep one locator.
- The main part of a split button is a `button` with the label of its option as its name.
- The dropdown part is a `button` named "More allow options" or "More refuse options", with `aria-haspopup="menu"`. It opens a `menu` of `menuitem` elements, each named with the label of its option.
- A plain button keeps the label of its option as its name.

Locked tests and checks that click an option by name:

- No locked acceptance test answers a permission request: the `tool` scenario of the simulated agent is used only in `tests/simulated-agent/agent.test.ts` (218, 235, 248), with its own client. This was a grep, not a run.
- The simulated agent offers "Allow" and "Refuse", one option for each group. They stay plain buttons, so A4, A5, S5-1 and S5-6 click them by name as before.
- An "always" option of a check (S5 choice 2 scenario) sits in the dropdown "More allow options". The S5 test author clicks the dropdown first.

### The S6 trust question (user decision, 2026-11-27)

S5 also changes the trust question of S6 (`QuestionDialog`, kind `trust`).

- Facts: S6 walks up from the session folder to the repository root, also past the workspace directory (`check-directory.handler.ts` 98-99). So a repository above the workspace directory R, for example a dotfiles repository in the home folder, asks for trust.
- The dialog keeps the fact "Repository" of S6, and adds the fact "Repository root" with the path. The facts "Folder" and "Profile" stay.
- When the repository root holds the workspace directory, the dialog shows a warning above the buttons:
  - "This repository holds the workspace directory <R>. Trust covers every plain folder under <R> for the profile <name>."
- The warning does not show for a repository inside the workspace directory.
- The buttons do not change: "Cancel" and the primary "Trust".
- "Holds the workspace directory" includes a root equal to R. `check-directory` compares with `pathKey`: the root holds R when `pathKey(root)` equals `pathKey(R)`, or R is inside the root.
- The question gets one field, `holdsWorkspace: boolean`. `check-directory` sets it. The question lives in memory, so no saved format changes.

### Not in this story

- Elicitations of the mode url.
- The `preview` of an option (`_meta`), which the adapter sends for mockups and code snippets.

## Screens

See the mockup. It shows these states:

- the current screen, for comparison
- no open card, during a turn
- two cards at once, each where Claude asked: tool A, card A, tool B, card B
- cards with the "always" options of real Claude, and a safety ask
- answer sent, and answer refused
- the screen after the first answer
- the screen after Stop
- a request with no title and no options
- question cards of Claude: a single select, a form with several questions, and the refusal fallback
- the live mode in the Mode control after a plan exit
- a card that came while the user scrolled up, with the jump button
- the S6 trust question with the repository root and the warning

Each state shows the fixed frame of S8, with no facts row in the header (user decision, 2026-11-27).

### Cards inline in the chat (user decision, 2026-11-27)

The user said: "all cards should be part of the chat like Claude code, not queue over the chat input and squeeze the chat window."

- Permission cards and the question cards of Claude show inside the log "Transcript", where Claude asked: at the place of their `answers` entry. They scroll with the chat, as in Claude Code.
- A card sits at the place where it arrived: its entry is saved when it opens, right after the tool call or the message that it belongs to. A later entry comes after it. In a turn, the agent waits for the answer, so the card is almost always last.
- This replaces the earlier rule "always after the last entry", because the crash path saves the card when it opens (user decision, 2026-11-27).
- Several cards show in the order of arrival. Two parallel requests read: tool A, card A, tool B, card B.
- Each card is an entry of the kind `answers`, saved when it opens. The renderer draws an open card as the live card of its request, at the place of its entry (by `entryId`), and a closed card from its entry.
- They are not in the bottom dock. The dock of S8 holds only the status line, the plan widget and the composer.
- The rules for the order, the recommended and primary option, the safety ask, Stop and requests outside a turn do not change.
- The S6 trust question stays the app-level dialog in m1 (user decision, 2026-11-27). The locked S6 tests find it as a `dialog`. Later item, out of m1: show it as a card in the chat.

### Scroll and the jump button

The advisor answered on the shape. Not hard to revert. The user likely agrees.

- At the bottom of the log, a new card comes into view by the follow rule of S8.
- When the user scrolled up, the log never moves.
- The status line then says "Waiting for your answer" and shows one compact button: "Show request".
  - It shows while a card is open and the log is not at the bottom. It reuses the state "at the bottom" of the S8 follow rule.
  - A click brings the oldest open card into view, and moves the focus to the card.
- A new card never takes the keyboard focus. A key meant for the composer must not answer a card.

### An answered card

The advisor answered. Not hard to revert.

- An answered decision card stays, as a saved entry (user decision, 2026-11-27). See "The answered decision card".
- Reason: an open card can stay last in the log, but a folded line needs a fixed place among later entries, and only an entry has one. After a revision gap, the window rebuilds its view from a new snapshot, so a line in view only would be lost.
- An answered question card does not disappear. It turns into a saved answered card (user decision, 2026-11-27). See "The answered card".

Changes against the current screen:

- Changed (S8): the session window is a fixed frame with a bottom dock. The header holds only the title and "Delete session".
- New: one permission card for each request, in the transcript where Claude asked.
- New: one question card for each question of Claude, in the transcript where Claude asked.
- Changed: the status line says "Waiting for your answer" while a card is open, with "Show request" when the log is not at the bottom.

Order in the session window, from the top. The S8 mockup uses the same order.

1. Header: the title and "Delete session" (fixed)
2. Transcript (the only scroll area): the entries, with each card at the place where Claude asked
3. Bottom dock:
   1. Status line
   2. Plan widget (S8)
   3. Composer

The status line keeps the S6 condition: it shows no "Starting Claude Code" while `asking` is true.

### Card content

- The layout of a decision card: the context (tool kind, tool title, locations) in the secondary color, then the question in the primary color, then the buttons. See "Decision cards".
- The tool title comes from the request. Without it, the card uses the title of the known tool entry. Without both, it shows "Tool call".
- The options form an allow group and a refuse group. See "Decision cards".
- Rule (user decision, 2026-11-27): the recommended option comes first, as the primary button. Buttons are compact.
  - Safety ask (user decision, open choice 7): when the first option of the agent is a refuse option, that option is the recommended one. It stays first and is primary. This is the `defaultToNo` order of Claude Code, where "No" is the default choice.
  - In every other case, the recommended option is the first `allow-once` option of the request. It comes first and is primary. Example: "Yes, manually approve edits" at the plan exit.
  - Within a group, the other options sit in the dropdown of its split button, in the order of the agent. See "Decision cards".
  - A request with no refuse option first and no `allow-once` option has no primary button. Its options keep the order of the agent.
  - Compact means like the buttons of the Claude desktop app: less height and padding, and smaller text than `.button`.
- The request of the Claude adapter carries `toolCallId`, `title` and `rawInput` (`permissions/presentation.js`, version 0.112.0).
- For a shell tool, the title is the command itself (`tool-calls/reporters/bash.js`). So the card shows the command without extra fields.
- For the plan exit over ACP version 1, the title is "Approve Plan" (`tool-calls/reporters/interaction.js` 21).
- The validator confirms the title of a shell request in the live run of A4 (step 7).

### Accessibility and marking

- A permission card is an element with the role `article` and the fixed name "Permission request". The tool title stays as text inside it.
- A question card has the role `article` and the fixed name "Claude asks". The message stays as text inside it.
- Reason: `toolCall` in `s4/fixture.ts` 344 finds a `group` in the log by a substring of its name. A card that is a `group` named by the tool title would give two matches. No locked test reads the role `article`.
- On a decision card, the main part of a split button and each plain button are named with the label of the option. The dropdown part is a `button` named "More allow options" or "More refuse options", with a `menu` of `menuitem` elements.
- On a question card, the buttons are "Submit" and "Skip".
- A single select is a `radiogroup` with `radio` rows. A multi select is a `group` with `checkbox` rows. The name of a row is its option label; its explanation is its description. The free text field has the name "Other".
- An answered question card is an `article` with the fixed name "Claude asked". An answered decision card is an `article` with the fixed name "Permission answered". Neither has a button.
- The cards inside the log keep the S4 checks of the log text: A2 and A6 use `toHaveText` with a pattern that allows text between the turns (`s4/chat.spec.ts` 119, `s4/restart.spec.ts` 78 and 85). A3 and A5 check the log after Stop, when no card is open.

## Data

- No migration. No new column.
- The queue of permission requests and elicitations lives in main memory. `docs/architecture.md` says that open questions live in memory only.
- The answer to a permission request adds one entry of the kind `answers`, with `card: "decision"` and one row (user decision, 2026-11-27). The tool call entry still shows the result: "Completed" after an allowed tool, and "Failed" after a refused one.
- The answer to a question of Claude adds one entry: the answered card (user decision, 2026-11-27).
  - New entry kind `answers` in `entrySchema` (`entry.ts`):

```ts
z.strictObject({
  kind: z.literal('answers'),
  card: z.enum(['decision', 'question']),  // added on 2026-11-27 for the answered decision card
  toolId: z.string().nullable(),          // the toolCallId of the elicitation, if any
  outcome: z.enum(['open', 'submitted', 'skipped', 'stopped', 'withdrawn', 'exited', 'quit', 'interrupted']),
  rows: z.array(z.strictObject({
    question: z.string(),                 // the message for one question, else the field description
    answer: z.string().nullable(),        // the picked labels, then the typed text; null when none
  })),
})
```

  - The entry saves what the card shows, not the field keys and not the UI texts. The renderer maps a null answer to the text of its reason (see "Cards that closed without an answer"). A later change of a reason text then needs no data change.
  - Exception: two texts are saved as shown, as history. The question text of a decision card (for example "Run this command?") and the answer "Answered" of a text field in a form that is not `AskUserQuestion`. A later change of these texts does not rewrite old entries. The approved shape does not change.
  - **The format is approved by the user on 2026-11-27**: the entry kind `answers`, the field `card: "decision" | "question"`, and `outcome` with the values `submitted`, `skipped`, `stopped`, `withdrawn`, `exited` and `quit`. The crash decision of the same day adds `open` and `interrupted` to the approved format. Hard to revert: yes, because the schema is strict on each read. A later new value is an addition.
  - Write path:
    1. When a card opens, main adds the entry with `addEntry`, with the outcome `open` and each row with `answer: null`.
    2. When the card closes, main replaces the same entry in place (same ID, same position), with the final outcome and the answers. It reuses the in-place replace of S8 (`Transcript.replace`, `SessionStore.updateEntry`, event `entry-replaced`).
    3. At app start, before any window loads, one store call changes each `answers` entry with the outcome `open` to `interrupted`. In SQL: `UPDATE entries SET data = json_set(data, '$.outcome', 'interrupted') WHERE kind = 'answers' AND json_extract(data, '$.outcome') = 'open'`. This is a repair at each start, not a migration.
  - The text of `interrupted`: "Not answered: Aether stopped unexpectedly." (skim list).
  - How a live card and its entry connect:
    - `PermissionView` and `ElicitationView` carry `entryId`, the ID of the `answers` entry that the card saved when it opened.
    - The renderer draws the live card in place of the entry with that `entryId`.
    - A saved entry with the outcome `open` never shows as a live card by itself. A live card comes only from the open requests of the snapshot. An `open` entry with no live request shows the text of `interrupted`. This covers a race; after the start repair, such an entry cannot exist.
  - A decision card saves one row: `question` is the question text of the card, for example "Run this command?", and `answer` is the label of the chosen option, or null for a cancel. The outcome is `submitted`, or the close reason (`stopped`, `withdrawn`, `exited`, `quit`, `interrupted`). `toolId` names the tool call, which shows the command or the path just above.
  - The only change of the approved shape is the field `card`. No other field changes.
  - No migration. Migration 002 has no CHECK that lists the kinds of entry; its only CHECK keeps the column `kind` equal to the key `kind` of the JSON. zod validates the kinds.
  - Hard to revert: yes. `entrySchema` is strict on each read, so a database that holds this kind fails on a build without it.
  - **Approved by the user on 2026-11-27.** It is an approved hot item. A change of it goes to the user.
  - The typed text of "Other" is saved only for `AskUserQuestion` forms. See open choice 10.
- Changed use of a saved column: `sessions.mode` now also changes after the first message, when the agent reports a live mode. Aether never saves `approve-all` this way. The values of the column do not change. Today only `sessions.set-mode` of a draft writes it.
- The live mode lives in memory only, for the session view, in two cases: Approve all, and a mode that comes with the notice for the fallback of Auto (decision B).
- Changed use of a saved column: `sessions.model` changes after the first message only after the refusal fallback (decision A).

## Interfaces

### Agent port (`src/building-blocks/agent.port.ts`)

Add neutral types. Only `providers/acp` knows the ACP names.

```ts
export type PermissionOptionKind = 'allow-once' | 'allow-always' | 'refuse-once' | 'refuse-always'

export interface PermissionOption {
  id: string            // the optionId of the agent
  label: string         // the name of the agent
  kind: PermissionOptionKind
}

export interface PermissionRequest {
  id: string            // made by Aether, unique in the process
  toolId: string        // the toolCallId of the agent
  title: string | null
  toolKind: string | null
  locations: string[]
  options: PermissionOption[]
}
```

- `AgentListener.permission(request: PermissionRequest): void`. A new request is open.
- `AgentListener.permissionClosed(requestId: string, reason: 'withdrawn' | 'exited'): void`. The provider calls it only for a withdraw or an exit that the slice did not start. A close that the slice starts (Stop, quit, delete) carries its reason in the slice.
- `AgentProcess.answer(requestId: string, optionId: string): Result<true, 'unknown-request' | 'unknown-option'>`. It answers one open request.
- `cancel()` and `close()` answer each open request with `cancelled` to the agent. They report nothing to the listener: the slice that called them names the reason.

### ACP provider (`src/providers/acp/acp-agents.ts`)

- Replace the handler that answers `cancelled` with a handler that keeps the request open.
- The handler returns a promise. The promise resolves with `{ outcome: { outcome: 'selected', optionId } }` or `{ outcome: { outcome: 'cancelled' } }`.
- The handler listens to the `signal` of the request. When the agent cancels the request, the provider calls `permissionClosed`.
- Map the ACP kinds: `allow_once` to `allow-once`, `allow_always` to `allow-always`, `reject_once` to `refuse-once`, `reject_always` to `refuse-always`.
- Map `toolCall.locations[].path` to `locations`.
- For the session ID of a request, see open choice 6.

### Contract `sessions.answer-permission`

The slice folder `src/features/sessions/answer-permission/` is already named in `docs/architecture.md`.

- Input: `{ id: string, requestId: string, optionId: string }`. `id` is the session ID.
- Result: `ok({})`.
- Errors:
  - `unknown-session`: "This session does not exist."
  - `unknown-request`: "This permission request is closed."
  - `unknown-option`: "Aether cannot send this answer."
- The handler finds the process of the session and calls `answer`. It removes the request from the queue and sends the event.

### Events and snapshot (`src/features/sessions/entry.ts`, `open.contract.ts`)

- The snapshot of `sessions.open` gets `permissions: PermissionView[]`, in the order of arrival.
- `PermissionView` is `{ id, entryId, toolId, title, toolKind, locations, options }`. `entryId` is the ID of its `answers` entry. The title is already resolved: request title, tool entry title, or "Tool call".
- Two new changes of `sessions.changed`. Each one carries the entry change and the request change together, so the window never sees one without the other:
  - `{ type: 'card-opened', entry: EntryView, card: { kind: 'permission', permission: PermissionView } | { kind: 'elicitation', elicitation: ElicitationView } }`: the new `answers` entry with the outcome `open`, and the open request.
  - `{ type: 'card-closed', entry: EntryView, id: string }`: the `answers` entry, replaced in place with its final outcome, and the ID of the request that closes.
- The `Transcript` class sends them, so the cards and the entries share one revision sequence. The renderer applies each change in one step.
- So on the normal path, an entry with the outcome `open` always has its live request in the view, and the text "Not answered: Aether stopped unexpectedly." never shows. The snapshot reads the entries and the open requests in one synchronous call, so it holds the same pair.

### Elicitations (port, provider, contract)

- Port types, neutral:

```ts
export type ElicitationField =
  | { key: string; kind: 'choice'; title: string | null; description: string | null; options: ElicitationChoice[] }
  | { key: string; kind: 'choices'; title: string | null; description: string | null; options: ElicitationChoice[] }
  | { key: string; kind: 'text'; title: string | null; description: string | null }
export interface ElicitationChoice { value: string; label: string; description: string | null }
export interface Elicitation { id: string; toolId: string | null; message: string; fields: ElicitationField[] }
export type ElicitationAnswer =
  | { action: 'submit'; values: Record<string, string | string[]> }
  | { action: 'skip' }
```

- `AgentListener.elicitation(request: Elicitation): void` and `AgentListener.elicitationClosed(id: string, reason: 'withdrawn' | 'exited'): void`, with the same rule as `permissionClosed`.
- `AgentProcess.answerElicitation(id, answer): Result<true, 'unknown-request' | 'invalid-answer'>`.
- `cancel()` and `close()` answer each open elicitation with `{ action: "cancel" }` to the agent. They report nothing to the listener.
- `providers/acp` declares `elicitation: { form: {} }` in `initialize`. It maps `oneOf` to `choice`, `items.anyOf` to `choices`, and a plain string to `text`. It answers -32602 for any other field, and shows no card. It maps `submit` to `accept`, and `skip` to `decline`.
- `providers/acp` keeps the order of the agent. No option is preselected. The `providers/claude-code` recipe still marks "Keep the refusal" as the first option of the refusal fallback.
- Contract `sessions.answer-elicitation`, slice `src/features/sessions/answer-elicitation/`:
  - Input: `{ id: string, elicitationId: string, answer: ElicitationAnswer }`.
  - Errors: `unknown-session`, `unknown-request` ("This question of Claude is closed."), `invalid-answer` ("Aether cannot send this answer.").
  - The main process checks each value against the fields of the request.
- Snapshot and events: `elicitations: ElicitationView[]` in the snapshot, in the order of arrival. The changes are `card-opened` and `card-closed`, as for permissions.
- `ElicitationView` is `{ id, entryId, toolId, message, fields }`. `id` is the request ID of Aether, `entryId` the ID of its `answers` entry, and `fields` the `ElicitationField` list of the port.

### Live mode (events and store)

- `record-agent-update` handles the port update `mode` of S7:
  1. It decides the S7 notice for the fallback of Auto against the saved mode.
  2. It saves the new mode in `sessions.mode`, unless the new mode is `approve-all`, or the update comes with the notice for the fallback of Auto (then `auto` stays saved).
  3. It sends the change `{ type: 'mode', mode }` of `sessions.changed`.
- The snapshot gets `liveMode: Mode | null`, in memory. The Mode control shows `liveMode ?? session.mode`.
- `record-agent-update` also handles the port update `model`: it saves `sessions.model` and sends the change `{ type: "model", model }`.
- `SessionStore` gets a method to save the mode of a session that is not a draft.

### Simulated agent (`tests/simulated-agent/`)

- Add a step that reports a mode change (`current_mode_update`).
- Add a step that sends `elicitation/create` with a given schema, and reports the answer to the test control.
- Declare nothing new in the simulated agent: it reads the client capability from `initialize` and reports it.

- Today the step `tool` uses the fixed tool ID `t1` and waits for its answer. It cannot send two requests at once.
- Add a step that sends several requests at the same time, each with its own tool ID. It reports each answer to the test control.
- Add a step that cancels one open request (`$/cancel_request`).
- Keep the options of the simulated agent: `Allow` (`allow_once`) and `Refuse` (`reject_once`). Add a scenario with an `allow_always` option for the "always" button.

## Terms

| Thing | UI | Code | Database |
|---|---|---|---|
| One request of the agent | Permission request (card heading) | `PermissionRequest`, `PermissionView` | none |
| The open requests | the cards in the transcript, where Claude asked | queue, `permissions` | none |
| A permission card | role `article`, name "Permission request" | `PermissionCard` | none |
| The jump to the oldest open card | "Show request" (status line) | none | none |
| A choice on a card | the label of the agent, for example "Yes" or "Allow" | `PermissionOption` | none |
| The status while a card shows | "Waiting for your answer" | any status and a queue that is not empty | none |
| A question of Claude | "Claude asks" (card heading) | `Elicitation`, `ElicitationView` | none |
| An answered question | "Claude asked" (card name) | entry kind `answers`, `card: "question"` | `entries.kind` = `answers` |
| An answered decision | "Permission answered" (card name) | entry kind `answers`, `card: "decision"` | `entries.kind` = `answers` |
| A permission card | "decision card" in this spec; `article` named "Permission request" | `PermissionCard` | none |
| The menu of the other allow options | "More allow options" | split button | none |
| The menu of the other refuse options | "More refuse options" | split button | none |
| The free text of a question | "Other" | `question_<n>_custom` (ACP key) | none |
| The mode that the agent reports | the Mode control | live mode, `liveMode` | `sessions.mode`, except Approve all |

- S6 uses "question" for the trust question and the directory question. S5 calls the questions of Claude "elicitations" in the code, so the two stay apart.
- The brief says "allow or refuse". Real Claude labels its options "Yes" and "No". See open choice 1.

## Error and empty states

| Case | Behavior |
|---|---|
| No open request | No card shows. The status line does not say "Waiting for your answer". |
| The answer fails with `unknown-request` | The card closed already, so the event removes it. The window shows nothing more. |
| The answer fails with `unknown-option` or another error | The card stays. It shows the message under its buttons. The buttons work again. |
| A request with no options | The card shows one button, "Cancel request". It answers `cancelled`. The adapter treats `cancelled` as "Tool use aborted", so the tool does not run. |
| A request with no allow option or no refuse option | The card shows the options that the agent offered. |
| A request with no title and an unknown tool ID | The card shows "Tool call". |
| A request after Stop, while the cancel runs, or while the process closes | The provider answers `cancelled`. No card shows. |
| A request when no turn runs | The card shows. Stop shows and cancels it. See "Requests outside a turn". |
| A request with an unknown session ID | See open choice 6. |
| The process exits with open requests | The cards close. The turn writes the error notice of S4. |
| A double click on a button | The first click switches the card to its answered layout, so the second click finds no button. Only one answer goes out. |
| A form with an unsupported field | The provider answers -32602. No card shows. |
| A question card when the process exits | The card closes. The agent gets nothing more. |
| No pick and no text | "Submit" is disabled. "Skip" sends `decline`. |

## Files and dependencies

### Files

- `src/building-blocks/agent.port.ts`: the new types and methods. Shared with S7.
- `src/providers/acp/acp-agents.ts`: the request handler, `answer`, and the cancel of open requests. Shared with S7 and S9. S6 does not touch it.
- `src/providers/acp/acp-agents.test.ts`
- `src/features/sessions/answer-permission/`: new slice with contract, controller, handler and test.
- `src/features/sessions/answer-elicitation/`: new slice with contract, controller, handler and test.
- `src/features/sessions/record-agent-update/record-agent-update.handler.ts`: the live mode. S7 adds its `mode` case. Shared with S7 and S8.
- `src/features/sessions/session.store.ts`: save the mode of a started session. Shared with S8 and S9.
- `src/renderer/src/components/ModeMenu.tsx`: show `liveMode ?? session.mode`. Shared with S8.
- New `src/renderer/src/components/ElicitationCard.tsx`.
- `src/renderer/src/components/QuestionDialog.tsx` (S6): the fact "Repository root" and the warning of the trust question.
- `src/features/repositories/question.ts` and `check-directory/check-directory.handler.ts` (S6): the field `holdsWorkspace`.
- `docs/architecture.md`, "Directories and trust": correct "Trust applies to one Git repository, not to the whole workspace directory." It is false when the repository root is above R. New text: "Trust applies to one Git repository. When the root of that repository holds the workspace directory, trust covers every plain folder under the workspace directory for that profile, and the question warns."
- `docs/decisions/0007-permissions-and-trust.md`: add a note, with the date, that squares the walk-up with the rejected alternative "Trust for the whole root". The note says: Aether still never trusts the root without a question. It trusts one repository. A repository above the root covers the root by containment, and the question names it before the user answers. This note records the user decision of 2026-11-27; it does not change the decision.
- `src/features/sessions/entry.ts` and `entry.test.ts`: the new changes, and the entry kind `answers`. Shared with S7 and S8.
- `src/features/sessions/transcript.store.ts`: the queue in memory and its events. Shared with S8.
- `src/features/sessions/open/open.contract.ts` and `open.handler.ts`: the snapshot.
- `src/features/sessions/send-message/send-message.handler.ts`: the listener, and the refusal of a message while a card is open. The end of a turn does not close the cards. Shared with S6, S7 and S9.
- `src/features/sessions/stop/stop.handler.ts`: Stop with no turn but open requests cancels them. The provider cancels the requests in `cancel`.
- `src/features/sessions/processes.store.ts`: only if the queue needs the process of a session. Shared with S9.
- `src/app/contracts.ts` and `src/app/main/composition.ts`: the new contract. Shared with S6, S7 and S9.
- `src/renderer/src/session-view.ts`: the new changes.
- `src/renderer/src/components/SessionPage.tsx`: the status line with "Waiting for your answer" and "Show request". Shared with S6 and S8.
- `src/renderer/src/components/Transcript.tsx`: the open cards after the entries, inside the log, and the case `answers` for the answered card. Shared with S8.
- New `src/renderer/src/components/PermissionCard.tsx`.
- `src/renderer/src/styles.css`: reuse `.question` and `.question-actions`. Add a compact button variant for the cards. Shared with S8.
- `tests/simulated-agent/agent.mjs`, `scenarios.mjs`, `control.ts`: the new steps. Shared with S7 and S9.
- `docs/architecture.md`: remove the sentence "Until the permission queue exists, Aether answers each permission request with cancelled." Remove the S5 row from "Known defects".

### Dependencies

- Needs: S4 (merged).
- Needs: S8 merged first. S8 makes the log the scroll element, and builds the follow rule and the status line in the dock. S5 puts its cards in that log, and the jump button in that status line. This changes the plan: S5 depended on S4 only.
- Needs: S7 merged first. The live mode uses the port update `mode` and the `mode` case of `record-agent-update` from S7.
- S5, S7 and S9 touch `acp-agents.ts`. S5, S6, S7 and S9 touch `send-message.handler.ts`. The coordinator merges them one at a time. The later story updates its branch.
- New scope from the user decisions of 2026-11-27: the live mode, and the cards for the questions of Claude (form elicitation). S5 grows by one slice, one card type, the capability and three port methods.
- S9 reads the queue in its idle rule. A request can come outside a turn, so S9 counts an open request as busy. See the S9 spec.

## Open choices

The advisor answered each choice. Its answer is recorded under the choice.

### 1. Labels of the option buttons

- **Decided by the user on 2026-11-27: option A, the labels of the agent.** The "always" options show with Claude's own labels. It is an approved hot item.
- The text below is the record of the options as they were offered.

- User column: yes (permissions, and the user owns the UI terms).
- Hard to revert: no.
- Options:
  - A. One button for each option, with the label of the agent. Impact: the label states the scope of a grant, for example "Yes, and don't ask again for npm commands". Real Claude shows "Yes" and "No", not "Allow" and "Refuse".
  - B. Fixed Aether labels by kind: "Allow", "Always allow", "Refuse", "Always refuse". Impact: the brief terms show, but the scope of an "always" grant is lost, and the plan exit options with two "allow" kinds look the same.
- Recommendation: A. The first `allow-once` option comes first and is primary. Each other option is plain. See "Card content".
- Advisor: A. "Only the agent's label states the scope of a grant." The user may disagree, because the brief says "refuses" and the user owns the terms.

### 2. The "always" options

- **Decided by the user on 2026-11-27: option A, show them.** They show with Claude's own labels, in the dropdown of the allow group (see "Decision cards"). It is an approved hot item.
- The text below is the record of the options as they were offered.

- User column: yes (permissions, security).
- Hard to revert: no.
- Facts from the Claude adapter (`@agentclientprotocol/claude-agent-acp` 0.112.0):
  - The "always" options of WebFetch and Skill add an allow rule with the destination `localSettings` (`permissions/effects.js`). Claude keeps such a rule in the settings of the repository folder (`.claude/settings.local.json`). It stays after the session.
  - The "always" options of MCP tools, the fallback tools and shell commands apply the change set of Claude itself (`permissions/effects.js` 161-163). Claude chooses the destination. This read did not prove it.
  - A file edit "always" option ("Yes, allow all edits during this session") can be `setMode acceptEdits` for the session (`permissions/options/filesystem.js` 104-117, 138-142, 194-196). So it changes the mode.
  - Every plan exit option except "Yes, manually approve edits" is an `allow_always` option (`permissions/options/tools.js` 194-230).
  - Aether stores no rule of its own in each case.
- Options:
  - A. Show each "always" option that the agent offers. Impact: the same choices as the native Claude apps; one click can add a permanent rule in the repository, or change the mode.
  - B. Hide the `allow-always` and `refuse-always` options in m1. Impact: no permanent rule and no mode change from Aether; the user answers each tool again; the plan exit keeps only "Yes, manually approve edits" and "No, keep planning", so its mode options also disappear.
- More impact of A: a rule in the repository folder applies in each profile that opens the repository. Trust is per profile (S6), so this rule crosses the profile line.
- Recommendation: A, with the label of the agent, so the user sees the scope.
- Advisor: A. The preference patterns 3 (close a security gap) and 4 (keep the scope small) conflict here, so the advisor predicts that the user may disagree.

### 3. The status while a card shows

- User column: no.
- Hard to revert: no.
- Options:
  - A. No new status value. Waiting is any status with a queue that is not empty. Impact: no change of the status contract; S9 needs no new value.
  - B. A new status `waiting`. Impact: a change of `sessionStatusSchema`, the renderer and S9.
- Recommendation: A.
- Advisor: A. The user likely agrees.

### 4. A trace of the answer in the transcript

- **Decided by the user on 2026-11-27, for questions only: a saved answered card.** The user said: "On Claude desktop the card changes and shows a list with the question and the answer. I would follow this pattern. Each question in primary, answers in secondary, and both in their own row inside the card. When multiple questions and answers we have separators between each row delimiting their space."
- **Decided by the user on 2026-11-27, for permissions too: a saved answered decision card.** The user said: "when we have already answered we shouldn't show the button disabled. We show only the question in secondary and the answer in primary inside the card." See "The answered decision card" and "Data".
- The text below is the record of the options as they were offered.

- User column: no. The saved format does not change.
- Hard to revert: no.
- Options:
  - A. No entry. The tool call shows the result. Impact: no change of the saved format.
  - B. A notice entry, for example "Allowed: npm test". Impact: a new notice code in the saved entries; more lines in the transcript.
- Recommendation: A.
- Advisor: A. The user likely agrees.

### 5. Plan exit options that change the mode

- **Decided by the user on 2026-11-27: show and save.** The coordinator relayed the decision: the Mode control shows the live mode from `current_mode_update`, and Aether saves it on the session. This also covers the file edit "always" that switches to Accept edits. Approve all shows, but is never saved: the session keeps its last saved mode, so a new process falls back to that mode, as decision 0012 rules for Approve all. A release then keeps the mode that the user chose.
- This is option C, extended with the save. See "Live mode". It is an approved hot item. A change of it goes to the user.
- The text below is the record of the options as they were offered.
- User column: yes (permissions; bypass needs a user choice, decision 0007).
- Hard to revert: no.
- Facts:
  - In the mode Plan, the Claude adapter asks to exit the plan with options such as "Yes, and use auto mode" and "Yes, and bypass permissions". The adapter offers bypass by default.
  - Every approval of the plan exit changes the mode, not only auto and bypass. `exit-plan-default` maps to the mode `default` (`permissions/effects.js` 82-83). Each approval returns `setMode` (`permissions/effects.js` 107-110).
  - The adapter then sends `current_mode_update` (`session-mode.js` 204-209).
  - S7 (#27) translates `current_mode_update` into the port update `mode`. This spec does not assume that the Mode control shows it.
  - `applySettings` sets the saved mode at each start. After a release (S9) or a restart, the session is in Plan again.
- Options:
  - A. Show these options as the agent offers them. Impact: the click is a user choice, as decision 0007 asks; the Mode control can show an old mode; a new process goes back to the saved mode.
  - B. Filter the bypass option in `providers/claude-code`. Impact: Aether never moves a session to bypass after the start; Aether needs Claude-specific option IDs.
  - C. A, and the Mode control shows the live mode from the port update `mode` of S7, in memory only. Impact: the user sees the real mode; small scope, because S7 already delivers the update; S5 then needs S7 merged; a new process still goes back to the saved mode.
- Recommendation: A for m1. Record the old mode in the Mode control, and the return to the saved mode, as known gaps.
- Advisor: A for m1. "The click on a labelled option is the user choice that decision 0007 asks for." The preference patterns 3 and 4 conflict, so the advisor predicts that the user may disagree. It is a hot item.
- Advisor, second consultation in the design review: C, if the `mode` update of S7 already reaches the session view; otherwise A. On `story/m1-s7-settings`, `record-agent-update.handler.ts` uses the `mode` update only for the notice of the Auto fallback. It does not reach the session view. So the answer stays A.

### 6. A request with another ACP session ID

- User column: no (interface between modules).
- Hard to revert: no.
- Facts:
  - The code of the Claude adapter can send the request of a subagent with the session ID of the child session of that subagent. It does so only for a client that declares the subagents capability.
  - Aether declares no subagents capability (`acp-agents.ts` 221). So each request carries the session ID of the owner session (`v1/acp-agent.js` 6970-6985).
  - Option A therefore changes nothing today. It keeps the subagent tools working if a later version declares the capability.
- Options:
  - A. Accept each request on the connection of the process. Impact: subagent tools work; one process serves one Aether session (decision 0006), so no request reaches another session.
  - B. Answer `cancelled` for a session ID that is not the session of the process. Impact: each tool of a subagent that needs a permission fails.
- Recommendation: A.
- Advisor: A, after a second consultation with the adapter facts. Not hard to revert. The user likely agrees.

### 7. A safety ask with a refuse option first

- **Decided by the user on 2026-11-27.** The user said: "The recommend choice is always primary and first, if the safety choices put no as first is it the primary choice? If yes we follow if no we do our way."
- Reading: Claude Code's `defaultToNo` makes "No" the default choice of a safety ask. So "No" is the recommended option there.
- Rule: the recommended option is always first and primary. On a safety ask, where the first option of the agent is a refuse option, that refuse option is the recommended one: it stays first and is primary. In every other case, the first `allow-once` option is first and primary.
- Neither offered option matched this. Option A kept "No" first with no primary button. It is an approved hot item. Check S5-6 covers it.
- The text below is the record of the options as they were offered.
- User column: yes. It is a permission prompt, and option A is an exception to the button rule of the user.
- Hard to revert: no.
- Facts:
  - For a safety ask, Claude sets `defaultToNo`. The adapter then puts the refuse options first (`permissions/options.js` 6-10, 52-60). ACP has no other field for a default option.
  - In every other case, the adapter already sorts the `allow_once` option first. So the user rule moves no button for Claude outside a safety ask.
- Options:
  - A. When the first option of the agent is a refuse option, keep the order of the agent and make no button primary. Impact: the safety hint of Claude stays; the user rule "recommended first" applies to every other request.
  - B. Always put the first `allow-once` option first, as the primary button. Impact: one rule for each card; a safety ask then invites an allow.
- Recommendation: A. The mockup shows a safety ask in state 3.
- Advisor: A. Not hard to revert. The user likely agrees (pattern 3: close a security gap).

### 8. `AskUserQuestion` without elicitation

- **Decided by the user on 2026-11-27: option B, inside S5.** The coordinator relayed the decision: Aether declares the ACP form elicitation capability, and shows Claude's questions as cards (now inline in the transcript, user decision of 2026-11-27), with compact buttons, the recommended option first and primary, a free text "Other" when the question allows it, and multi select when asked.
- See "Questions of the agent" for the protocol facts, the scope and the rules. Checks S5-9 to S5-12 cover it. It is an approved hot item.
- MCP elicitations: a form that uses only the three supported field types renders on the same path at no extra cost. Each other MCP form gets -32602, so the MCP server receives `cancel`. URL elicitations stay off.
- The text below is the record of the options as they were offered.
- User column: yes (scope).
- Hard to revert: no.
- Facts: without the form elicitation capability, the adapter disables `AskUserQuestion` completely (`v1/acp-agent.js` 7893). Claude then asks its questions in plain text, or not at all.
- Options:
  - A. Accept the gap in m1. Record it in `docs/architecture.md`. Impact: no new scope; Claude cannot show a choice list to the user.
  - B. A new story declares form elicitation and shows the question as a card in the dock. Impact: more scope in m1; a new card type and a mockup.
- Recommendation: A.
- Advisor: A. Not hard to revert. The user likely agrees (pattern 4: keep the scope small).

### 9. A request outside a turn

- User column: no (an error or empty state not in the brief).
- Hard to revert: no.
- Options:
  - A. Show the card, as during a turn. Stop shows and cancels it. Impact: a background task of the agent can still ask the user; `stop.handler.ts` and `send-message.handler.ts` change.
  - B. Answer `cancelled` at once, with no card. Impact: no change of Stop and Send; a tool of a background task fails without a word.
- Recommendation: A.
- Advisor: A. Not hard to revert. The user likely agrees.

### 10. The typed text of a form that is not `AskUserQuestion`

- **Decided by the user on 2026-11-27: option A.** A form that is not `AskUserQuestion` saves "Answered" for a text field. Typed text is saved only for Claude's own questions. It is an approved hot item.
- The text below is the record of the options as they were offered.

- User column: yes (credentials). The brief says "Aether stores no key and no token".
- Hard to revert: no.
- Facts: an MCP form renders on the same path as `AskUserQuestion`. Its text field can hold a secret, and the answered card would save it in SQLite.
- How Aether knows the form: the `providers/claude-code` recipe, as for the refusal fallback. An `AskUserQuestion` form has a `toolCallId`, and each key is `question_<n>` or `question_<n>_custom` (`elicitation.js` 122-175). An MCP form has no `toolCallId` (`mcpElicitationToCreateRequest`).
- Options:
  - A. Save the typed text only for `AskUserQuestion` forms. Other forms save "Answered" for a text field. Impact: no secret of an MCP form lands in the database; the answered card of an MCP form hides the typed text.
  - B. Save the typed text of each form. Impact: the full answer shows; a secret of an MCP form can land in the database.
- Recommendation: A.
- Advisor: A. It is a hot item.

## Skim list

Small texts and details that the advisor accepted. The user can veto each one.

- The status text "Waiting for your answer".
- The button "Cancel request" for a request with no options.
- The card heading "Permission request".
- The texts of a card that closed without an answer: "Not answered: you pressed Stop.", "Not answered: Claude withdrew it.", "Not answered: Claude Code exited.", "Not answered: Aether closed.", "Not answered: you skipped it.", "Not answered: Aether stopped unexpectedly."
- The fixed card names "Claude asks" (open) and "Claude asked" (answered).
- The question texts of the decision cards: "Run this command?", "Make this change?", "Read this?", "Fetch this?", "Approve the plan?", "Allow this tool?".
- The dropdown names "More allow options" and "More refuse options".
- The jump button "Show request".
- The refusal fallback keeps its two buttons.
