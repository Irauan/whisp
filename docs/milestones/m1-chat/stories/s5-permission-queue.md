# S5 Permission queue: story spec

Status: draft for the design review. Not approved.

- Milestone: m1-chat. Path step 6.
- Checks: A4, A5.
- Defect fixed: "Aether cancels each permission request, so a tool that needs a question fails" (`docs/architecture.md`, Known defects).
- Mockup: [s5-permission-queue.mockup.html](s5-permission-queue.mockup.html).
- Depends on: S4 (merged) and S8 (the fixed frame and the bottom dock). Shares files with S6, S7, S8 and S9. See "Files and dependencies".

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
- A request closes one time only. When Stop and a cancel of the agent arrive together, the agent gets one answer and the window gets one `permission-removed`.
- A process exit, a crash and the deletion of the session close the cards.
- The end of a turn does not close a card. The agent cancels a request that it no longer waits for.
- The queue lives in memory only. It does not survive a restart of Aether (`docs/architecture.md`, Agents).
- The main process accepts an answer only for an open request of that session, and only with an option that the request offered.
- A request that comes after Stop, while the cancel of that turn runs, gets `cancelled` at once. It shows no card.

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
| Waiting for permission | One card for each open request, above the composer. The status line says "Waiting for your answer". Stop is available. This holds with any status, also outside a turn. |
| Answer sent | The buttons of that card are disabled until the card closes. |
| Answer refused by the main process | The card stays. It shows the reason under its buttons. The buttons work again. |
| After Stop | No card. The transcript shows "Stopped." The open tool calls show "Failed". The composer is ready. |

The session status does not get a new value. "Waiting for permission" is any status with a queue that is not empty. See open choice 3.

- While a card is open, the composer shows Stop, not Send.
- `sessions.send-message` refuses a message while a card is open, with the existing error `turn-active`. The user answers the card or clicks Stop first.

### Checks

| ID | Check | Level |
|---|---|---|
| A4 | The agent asks two permissions at the same time. The user allows the first and refuses the second. Both cards show. The agent receives each answer for its own request. (live) | Acceptance |
| A5 | Two open requests. The user clicks Stop. Both cards close. The agent receives `cancelled` for both. | Acceptance |
| S5-1 | The user answers the second card first. Each request gets its own answer. | Acceptance |
| S5-2 | The agent cancels one of two requests. Only that card closes. | Slice |
| S5-3 | An answer with an unknown request ID, or with an option that the request did not offer, fails. The agent gets nothing. | Slice |
| S5-4 | The agent process exits while two requests are open. Both cards close. | Slice |
| S5-5 | A request comes when no turn runs. A card shows. Stop cancels it, and the agent receives `cancelled`. | Slice |
| S5-6 | A safety ask with "No" first. "No" is the first and the primary button. In another request, the first `allow-once` option is first and primary. | Acceptance |
| S5-7 | The agent reports the mode `accept-edits` after a plan exit. The Mode control shows "Accept edits". After a restart, the session starts in `accept-edits`. | Acceptance |
| S5-8 | The agent reports `bypassPermissions`. The Mode control shows "Approve all". The saved mode stays the last saved mode. A new process starts in that mode. | Slice |
| S5-9 | `initialize` declares form elicitation. The agent sends a single select question. The card shows the options with the recommended one first and primary. A click sends `accept` with that `const`. | Acceptance |
| S5-10 | A multi select question with "Other": the user toggles two options, types a text and submits. The agent receives the array and the custom text. | Acceptance |
| S5-11 | "Skip" sends `decline`. Stop sends `cancel` for an open question card. | Slice |
| S5-12 | A form with a number field gets the error -32602, and no card shows. | Slice |

S5-1 to S5-12 are not in the brief. They cover the rules above.

The references to lines of the adapter (`v1/acp-agent.js` and others) in this spec come from the design review, not from the first read of this spec.

### Live mode (user decision, open choice 5)

- An option can change the mode of the agent: a plan exit approval, or the file edit option "Yes, allow all edits during this session".
- The agent then sends `current_mode_update`. S7 translates it into the port update `mode`.
- The Mode control shows this live mode at once.
- Aether saves the live mode in `sessions.mode`, so a new process starts in it. A release (S9) and a restart keep the mode that the user chose.
- Approve all (`approve-all`, Claude `bypassPermissions`) shows in the Mode control, but Aether never saves it. The session keeps its last saved mode. A new process then falls back to that mode. This follows the rule of decision 0012 for Approve all.
- The S7 notice for the fallback of Auto compares the reported mode with the asked mode. `record-agent-update` decides the notice first, then saves the new mode.
- A new session copies the mode of the newest session (decision 0012). A saved live mode counts. Approve all is never copied, as before.
- After the first message, the user still cannot change the Mode control. Only the agent changes the mode.

### Questions of the agent (user decision, open choice 8)

Scope: S5 grows. Aether declares the ACP form elicitation capability. Claude's `AskUserQuestion` then works, and its questions show as cards in the same queue of the dock.

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

#### The question card

- Heading: "Claude asks". The card is a group with the name of the message.
- The message, then each question with its `title` as a small label.
- Single select, one question: one compact button for each option. A click sends the answer at once.
- The recommended option comes first and is primary:
  - the option whose label ends with "(Recommended)", as Claude marks it
  - else the `default` of the field
  - else the first option
  - The other options keep the order of the agent.
- Multi select: one compact toggle button for each option, with `aria-pressed`. A compact primary "Submit" sends the answer.
- Several questions in one form: each question shows its options as toggles, and one "Submit" sends all answers.
- "Other": a one-line text field under the options. Typing in it, then Enter or "Submit", sends the text as `question_<n>_custom`.
- "Skip": a compact plain button. It sends `decline`.
- Stop closes the card and sends `cancel`.
- The card follows the rules of a permission card: oldest first, one answer only, the buttons disabled after a click, and the error line under the buttons.
- An option `description` shows as muted text under the option, or as its `title` attribute when the card is narrow.

### Not in this story

- Elicitations of the mode url.
- The `preview` of an option (`_meta`), which the adapter sends for mockups and code snippets.

## Screens

See the mockup. It shows these states:

- the current screen, for comparison
- empty queue, during a turn
- two cards at once, oldest first
- a card with the "always" options of real Claude
- answer sent, and answer refused
- the screen after Stop
- a request with no title and no options
- a question card of Claude: a single select, and a multi select with "Other"
- the live mode in the Mode control after a plan exit

Each state shows the fixed frame of S8.

### The frame and the bottom dock

The user decided on 2026-11-27: "the text input for questions and chat should be anchored in the bottom of the feed."

- S8 builds the fixed frame: the header at the top, the transcript as the only scroll area, and a bottom dock that stays in view. See the S8 spec, "The session window frame".
- S5 adds the permission queue to the dock. S5 does not build the frame.
- The transcript scrolls under the dock. It stays at the bottom while new entries arrive.
- With many cards, the queue scrolls inside its own area. The dock itself never scrolls, so the composer and the Stop button stay in view. See the S8 spec, "The session window frame".
- The composer is the composer of S8, like the GitHub app: a text area of 2 to 8 lines, and a control row inside the box with "+", Mode, the model and the round Send or Stop button. S5 does not change the composer. See the S8 spec, "The composer".

Changes against the current screen:

- Changed (S8): the session window is a fixed frame with a bottom dock.
- New: the permission queue, a region in the dock, below the plan widget and above the composer.
- New: one permission card for each open request.
- Changed: the status line says "Waiting for your answer" while the queue has a card.

Order in the session window, from the top. The S8 mockup uses the same order.

1. Header and facts (fixed)
2. Transcript (the only scroll area)
3. Bottom dock:
   1. Status line
   2. Plan widget (S8)
   3. Permission queue (S5)
   4. Composer

The trust and directory questions of S6 are an app-level dialog (`QuestionDialog` in `App.tsx`), not cards in the dock. The status line keeps the S6 condition: it shows no "Starting Claude Code" while `asking` is true.

### Card content

- The heading: "Permission request".
- The tool title. It comes from the request. Without it, the card uses the title of the known tool entry. Without both, it shows "Tool call".
- The tool kind, for example `execute` or `edit`.
- The locations of the request (file paths), when the request has them.
- One button for each option.
- Rule (user decision, 2026-11-27): the recommended option comes first, as the primary button. Buttons are compact.
  - Safety ask (user decision, open choice 7): when the first option of the agent is a refuse option, that option is the recommended one. It stays first and is primary. This is the `defaultToNo` order of Claude Code, where "No" is the default choice.
  - In every other case, the recommended option is the first `allow-once` option of the request. It comes first and is primary. Example: "Yes, manually approve edits" at the plan exit.
  - The other options follow in the order of the agent.
  - A request with no refuse option first and no `allow-once` option has no primary button. Its options keep the order of the agent.
  - Compact means like the buttons of the Claude desktop app: less height and padding, and smaller text than `.button`.
- The request of the Claude adapter carries `toolCallId`, `title` and `rawInput` (`permissions/presentation.js`, version 0.112.0).
- For a shell tool, the title is the command itself (`tool-calls/reporters/bash.js`). So the card shows the command without extra fields.
- For the plan exit over ACP version 1, the title is "Approve Plan" (`tool-calls/reporters/interaction.js` 21).
- The validator confirms the title of a shell request in the live run of A4 (step 7).

### Accessibility

- The queue is a region with the name "Permission requests".
- Each card is a group with the name of its tool title.
- Each option is a button with its label as its name.
- The region "Permission requests" holds both kinds of cards: permission requests and questions of Claude.
- A question card is a group with the name of its message. A toggle of a multi select has `aria-pressed`. The free text field has the name "Other".

## Data

- No migration. No new column.
- The queue of permission requests and elicitations lives in main memory. `docs/architecture.md` says that open questions live in memory only.
- The answer adds no entry to the transcript. The tool call entry shows the result: "Completed" after an allowed tool, and "Failed" after a refused one. See open choice 4.
- Changed use of a saved column: `sessions.mode` now also changes after the first message, when the agent reports a live mode. Aether never saves `approve-all` this way. The values of the column do not change. Today only `sessions.set-mode` of a draft writes it.
- The live Approve all lives in memory only, for the session view.

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
- `AgentListener.permissionClosed(requestId: string): void`. The request closed without an answer of the user: the agent cancelled it, Stop cancelled it, or the process ended.
- `AgentProcess.answer(requestId: string, optionId: string): Result<true, 'unknown-request' | 'unknown-option'>`. It answers one open request.
- `cancel()` and `close()` also answer each open request with `cancelled` and call `permissionClosed` for each.

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
- `PermissionView` is `{ id, toolId, title, toolKind, locations, options }`. The title is already resolved: request title, tool entry title, or "Tool call".
- Two new changes of `sessions.changed`:
  - `{ type: 'permission-added', permission: PermissionView }`
  - `{ type: 'permission-removed', id: string }`
- The `Transcript` class sends them, so the queue and the entries share one revision sequence.

### Elicitations (port, provider, contract)

- Port types, neutral:

```ts
export type ElicitationField =
  | { key: string; kind: 'choice'; title: string | null; options: ElicitationChoice[]; recommended: string | null }
  | { key: string; kind: 'choices'; title: string | null; options: ElicitationChoice[]; recommended: string | null }
  | { key: string; kind: 'text'; title: string | null; description: string | null }
export interface ElicitationChoice { value: string; label: string; description: string | null }
export interface Elicitation { id: string; toolId: string | null; message: string; fields: ElicitationField[] }
export type ElicitationAnswer =
  | { action: 'submit'; values: Record<string, string | string[]> }
  | { action: 'skip' }
```

- `AgentListener.elicitation(request: Elicitation): void` and `AgentListener.elicitationClosed(id: string): void`.
- `AgentProcess.answerElicitation(id, answer): Result<true, 'unknown-request' | 'invalid-answer'>`.
- `cancel()` and `close()` answer each open elicitation with `{ action: "cancel" }`.
- `providers/acp` declares `elicitation: { form: {} }` in `initialize`. It maps `oneOf` to `choice`, `items.anyOf` to `choices`, and a plain string to `text`. It answers -32602 for any other field, and shows no card. It maps `submit` to `accept`, and `skip` to `decline`.
- `providers/acp` finds the recommended option: the label that ends with "(Recommended)", else the `default`, else the first option.
- Contract `sessions.answer-elicitation`, slice `src/features/sessions/answer-elicitation/`:
  - Input: `{ id: string, elicitationId: string, answer: ElicitationAnswer }`.
  - Errors: `unknown-session`, `unknown-request` ("This question of Claude is closed."), `invalid-answer` ("Aether cannot send this answer.").
  - The main process checks each value against the fields of the request.
- Snapshot and events: `elicitations: ElicitationView[]` in the snapshot, in the order of arrival, and the changes `elicitation-added` and `elicitation-removed`. One queue order holds both kinds of cards: the dock shows them oldest first, mixed.

### Live mode (events and store)

- `record-agent-update` handles the port update `mode` of S7:
  1. It decides the S7 notice for the fallback of Auto against the saved mode.
  2. It saves the new mode in `sessions.mode`, unless the new mode is `approve-all`.
  3. It sends the change `{ type: 'mode', mode }` of `sessions.changed`.
- The snapshot gets `liveMode: Mode | null`, in memory. The Mode control shows `liveMode ?? session.mode`.
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
| The list of open requests | Permission requests (region name) | queue, `permissions` | none |
| A choice on a card | the label of the agent, for example "Yes" or "Allow" | `PermissionOption` | none |
| The status while a card shows | "Waiting for your answer" | any status and a queue that is not empty | none |
| A question of Claude | "Claude asks" (card heading) | `Elicitation`, `ElicitationView` | none |
| The free text of a question | "Other" | `question_<n>_custom` (ACP key) | none |
| The mode that the agent reports | the Mode control | live mode, `liveMode` | `sessions.mode`, except Approve all |

- S6 uses "question" for the trust question and the directory question. S5 calls the questions of Claude "elicitations" in the code, so the two stay apart.
- The brief says "allow or refuse". Real Claude labels its options "Yes" and "No". See open choice 1.

## Error and empty states

| Case | Behavior |
|---|---|
| No open request | The queue region does not show. |
| The answer fails with `unknown-request` | The card closed already, so the event removes it. The window shows nothing more. |
| The answer fails with `unknown-option` or another error | The card stays. It shows the message under its buttons. The buttons work again. |
| A request with no options | The card shows one button, "Cancel request". It answers `cancelled`. The adapter treats `cancelled` as "Tool use aborted", so the tool does not run. |
| A request with no allow option or no refuse option | The card shows the options that the agent offered. |
| A request with no title and an unknown tool ID | The card shows "Tool call". |
| A request after Stop, while the cancel runs | The provider answers `cancelled`. No card shows. |
| A request when no turn runs | The card shows. Stop shows and cancels it. See "Requests outside a turn". |
| A request with an unknown session ID | See open choice 6. |
| The process exits with open requests | The cards close. The turn writes the error notice of S4. |
| A double click on a button | The first click disables the buttons of the card. Only one answer goes out. |
| A form with an unsupported field | The provider answers -32602. No card shows. |
| A question card when the process exits | The card closes. The agent gets nothing more. |
| "Submit" with nothing chosen and no text | It sends `accept` with empty content. Claude reads it as skipped. |

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
- `src/features/sessions/entry.ts`: the new changes. Shared with S7 and S8.
- `src/features/sessions/transcript.store.ts`: the queue in memory and its events. Shared with S8.
- `src/features/sessions/open/open.contract.ts` and `open.handler.ts`: the snapshot.
- `src/features/sessions/send-message/send-message.handler.ts`: the listener, and the refusal of a message while a card is open. The end of a turn does not close the cards. Shared with S6, S7 and S9.
- `src/features/sessions/stop/stop.handler.ts`: Stop with no turn but open requests cancels them. The provider cancels the requests in `cancel`.
- `src/features/sessions/processes.store.ts`: only if the queue needs the process of a session. Shared with S9.
- `src/app/contracts.ts` and `src/app/main/composition.ts`: the new contract. Shared with S6, S7 and S9.
- `src/renderer/src/session-view.ts`: the new changes.
- `src/renderer/src/components/SessionPage.tsx`: the queue in the bottom dock of S8, and the status line. Shared with S6 and S8.
- New `src/renderer/src/components/PermissionQueue.tsx`.
- `src/renderer/src/styles.css`: reuse `.question` and `.question-actions`. Add a compact button variant for the cards. Shared with S8.
- `tests/simulated-agent/agent.mjs`, `scenarios.mjs`, `control.ts`: the new steps. Shared with S7 and S9.
- `docs/architecture.md`: remove the sentence "Until the permission queue exists, Aether answers each permission request with cancelled." Remove the S5 row from "Known defects".

### Dependencies

- Needs: S4 (merged).
- Needs: S8 merged first. S8 builds the fixed frame and the bottom dock, and S5 adds its queue to the dock. This changes the plan: S5 depended on S4 only. The S5 test author can still run before S8 merges, if its tests check the place of the queue only (below the transcript, above the text field "Prompt").
- Needs: S7 merged first. The live mode uses the port update `mode` and the `mode` case of `record-agent-update` from S7.
- S5, S7 and S9 touch `acp-agents.ts`. S5, S6, S7 and S9 touch `send-message.handler.ts`. The coordinator merges them one at a time. The later story updates its branch.
- New scope from the user decisions of 2026-11-27: the live mode, and the cards for the questions of Claude (form elicitation). S5 grows by one slice, one card type, the capability and three port methods.
- S9 reads the queue in its idle rule. A request can come outside a turn, so S9 counts an open request as busy. See the S9 spec.

## Open choices

The advisor answered each choice. Its answer is recorded under the choice.

### 1. Labels of the option buttons

- User column: yes (permissions, and the user owns the UI terms).
- Hard to revert: no.
- Options:
  - A. One button for each option, with the label of the agent. Impact: the label states the scope of a grant, for example "Yes, and don't ask again for npm commands". Real Claude shows "Yes" and "No", not "Allow" and "Refuse".
  - B. Fixed Aether labels by kind: "Allow", "Always allow", "Refuse", "Always refuse". Impact: the brief terms show, but the scope of an "always" grant is lost, and the plan exit options with two "allow" kinds look the same.
- Recommendation: A. The first `allow-once` option comes first and is primary. Each other option is plain. See "Card content".
- Advisor: A. "Only the agent's label states the scope of a grant." The user may disagree, because the brief says "refuses" and the user owns the terms.

### 2. The "always" options

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

- **Decided by the user on 2026-11-27: option B, inside S5.** The coordinator relayed the decision: Aether declares the ACP form elicitation capability, and shows Claude's questions as cards in the same dock queue, with compact buttons, the recommended option first and primary, a free text "Other" when the question allows it, and multi select when asked.
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

## Skim list

Small texts and details that the advisor accepted. The user can veto each one.

- The status text "Waiting for your answer".
- The button "Cancel request" for a request with no options.
- The card heading "Permission request".
