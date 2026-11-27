# S5 Permission queue: story spec

Status: draft for the design review. Not approved.

- Milestone: m1-chat. Path step 6.
- Checks: A4, A5.
- Defect fixed: "Aether cancels each permission request, so a tool that needs a question fails" (`docs/architecture.md`, Known defects).
- Mockup: [s5-permission-queue.mockup.html](s5-permission-queue.mockup.html).
- Depends on: S4 (merged). Shares files with S6, S7 and S9. See "Files and dependencies".

## Behavior

### Flow

1. The agent sends `session/request_permission` during a turn.
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
- The end of a turn closes each card that is left. A process exit, a crash and the deletion of the session also close the cards.
- The queue lives in memory only. It does not survive a restart of Aether (`docs/architecture.md`, Agents).
- The main process accepts an answer only for an open request of that session, and only with an option that the request offered.
- A request that comes when no turn runs, or after Stop, gets `cancelled` at once. It shows no card.
- The renderer cannot grant a permission without a request. A compromised renderer can still answer an open request. `docs/architecture.md` accepts this risk.

### States

| State | What the user sees |
|---|---|
| Working, queue empty | Today's screen: the transcript and "Working". |
| Waiting for permission | One card for each open request, above the composer. The status line says "Waiting for your answer". Stop is available. |
| Answer sent | The buttons of that card are disabled until the card closes. |
| Answer refused by the main process | The card stays. It shows the reason under its buttons. The buttons work again. |
| After Stop | No card. The transcript shows "Stopped." The open tool calls show "Failed". The composer is ready. |

The session status does not get a new value. "Waiting for permission" is the status `working` with a queue that is not empty. See open choice 3.

### Checks

| ID | Check | Level |
|---|---|---|
| A4 | The agent asks two permissions at the same time. The user allows the first and refuses the second. Both cards show. The agent receives each answer for its own request. (live) | Acceptance |
| A5 | Two open requests. The user clicks Stop. Both cards close. The agent receives `cancelled` for both. | Acceptance |
| S5-1 | The user answers the second card first. Each request gets its own answer. | Acceptance |
| S5-2 | The agent cancels one of two requests. Only that card closes. | Slice |
| S5-3 | An answer with an unknown request ID, or with an option that the request did not offer, fails. The agent gets nothing. | Slice |
| S5-4 | The agent process exits while two requests are open. Both cards close. | Slice |

S5-1 to S5-4 are not in the brief. They cover the rules above.

### Not in this story

- `AskUserQuestion` of Claude goes through ACP elicitation, not through a permission request. Aether does not declare elicitation. No story in m1 covers it.
- The mode that an option can set. See open choice 5.

## Screens

See the mockup. It shows these states:

- the current screen, for comparison
- empty queue, during a turn
- two cards at once, oldest first
- a card with the "always" options of real Claude
- answer sent, and answer refused
- the screen after Stop

Changes against the current screen:

- New: the permission queue, a region below the plan widget and above the composer.
- New: one permission card for each open request.
- Changed: the status line says "Waiting for your answer" while the queue has a card.

Order in the session window, from the top. The S8 mockup uses the same order.

1. Header and facts
2. Transcript
3. Status line
4. Plan widget (S8)
5. Permission queue (S5)
6. Composer

### Card content

- The heading: "Permission request".
- The tool title. It comes from the request. Without it, the card uses the title of the known tool entry. Without both, it shows "Tool call".
- The tool kind, for example `execute` or `edit`.
- The locations of the request (file paths), when the request has them.
- One button for each option, in the order of the agent.
- The request of the Claude adapter carries `toolCallId`, `title` and `rawInput` (`permissions/presentation.js`, version 0.112.0).
- For a shell tool, the title is the command itself (`tool-calls/reporters/bash.js`). So the card shows the command without extra fields.
- For the plan exit, the title is "Ready to code?".
- The validator confirms the title of a shell request in the live run of A4 (step 7).

### Accessibility

- The queue is a region with the name "Permission requests".
- Each card is a group with the name of its tool title.
- Each option is a button with its label as its name.

## Data

No saved data changes.

- The queue lives in main memory. `docs/architecture.md` says that open questions live in memory only.
- The answer adds no entry to the transcript. The tool call entry shows the result: "Completed" after an allowed tool, and "Failed" after a refused one. See open choice 4.
- No migration.

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

### Simulated agent (`tests/simulated-agent/`)

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
| The status while a card shows | "Waiting for your answer" | status `working` and a queue that is not empty | none |

- S6 uses "question" for the trust question and the directory question. S5 does not use "question", so the two stay apart.
- The brief says "allow or refuse". Real Claude labels its options "Yes" and "No". See open choice 1.

## Error and empty states

| Case | Behavior |
|---|---|
| No open request | The queue region does not show. |
| The answer fails with `unknown-request` | The card closed already, so the event removes it. The window shows nothing more. |
| The answer fails with `unknown-option` or another error | The card stays. It shows the message under its buttons. The buttons work again. |
| A request with no options | The card shows one button, "Cancel request". It answers `cancelled`. |
| A request with no allow option or no refuse option | The card shows the options that the agent offered. |
| A request with no title and an unknown tool ID | The card shows "Tool call". |
| A request after Stop, or when no turn runs | The provider answers `cancelled`. No card shows. |
| A request with an unknown session ID | See open choice 6. |
| The process exits with open requests | The cards close. The turn writes the error notice of S4. |
| A double click on a button | The first click disables the buttons of the card. Only one answer goes out. |

## Files and dependencies

### Files

- `src/building-blocks/agent.port.ts`: the new types and methods. Shared with S7 and S9.
- `src/providers/acp/acp-agents.ts`: the request handler, `answer`, and the cancel of open requests. Shared with S6, S7 and S9.
- `src/providers/acp/acp-agents.test.ts`
- `src/features/sessions/answer-permission/`: new slice with contract, controller, handler and test.
- `src/features/sessions/entry.ts`: the new changes. Shared with S7 and S8.
- `src/features/sessions/transcript.store.ts`: the queue in memory and its events. Shared with S8.
- `src/features/sessions/open/open.contract.ts` and `open.handler.ts`: the snapshot.
- `src/features/sessions/send-message/send-message.handler.ts`: the listener, and the close of the cards at the end of a turn. Shared with S6, S7 and S9.
- `src/features/sessions/stop/stop.handler.ts`: no change expected. The provider cancels the requests in `cancel`.
- `src/features/sessions/processes.store.ts`: only if the queue needs the process of a session. Shared with S9.
- `src/app/contracts.ts` and `src/app/main/composition.ts`: the new contract. Shared with S6, S7 and S9.
- `src/renderer/src/session-view.ts`: the new changes.
- `src/renderer/src/components/SessionPage.tsx`: the queue and the status line. Shared with S6 and S8.
- New `src/renderer/src/components/PermissionQueue.tsx`.
- `src/renderer/src/styles.css`: reuse `.question`, `.question-actions` and `.button`. Shared with S8.
- `tests/simulated-agent/agent.mjs`, `scenarios.mjs`, `control.ts`: the new steps. Shared with S7 and S9.
- `docs/architecture.md`: remove the sentence "Until the permission queue exists, Aether answers each permission request with cancelled." Remove the S5 row from "Known defects".

### Dependencies

- Needs: S4 (merged).
- S5, S6 and S9 touch the agent process code. The coordinator merges them one at a time. The later story updates its branch.
- S9 reads the queue in its idle rule. The queue only exists during a turn, so S9 does not need S5 code to start.

## Open choices

The advisor answered each choice. Its answer is recorded under the choice.

### 1. Labels of the option buttons

- User column: yes (permissions, and the user owns the UI terms).
- Hard to revert: no.
- Options:
  - A. One button for each option, with the label of the agent. Impact: the label states the scope of a grant, for example "Yes, and don't ask again for npm commands". Real Claude shows "Yes" and "No", not "Allow" and "Refuse".
  - B. Fixed Aether labels by kind: "Allow", "Always allow", "Refuse", "Always refuse". Impact: the brief terms show, but the scope of an "always" grant is lost, and the plan exit options with two "allow" kinds look the same.
- Recommendation: A. Style each button by its kind: the first `allow-once` option is primary, each refuse option is plain.
- Advisor: A. "Only the agent's label states the scope of a grant." The user may disagree, because the brief says "refuses" and the user owns the terms.

### 2. The "always" options

- User column: yes (permissions, security).
- Hard to revert: no.
- Facts from the Claude adapter (`@agentclientprotocol/claude-agent-acp` 0.112.0):
  - The "always" options of WebFetch, Skill, MCP tools and the fallback tools add an allow rule with the destination `localSettings` (`permissions/effects.js`). Claude keeps such a rule in the settings of the repository folder (`.claude/settings.local.json`). It stays after the session.
  - The "always" option of a shell command uses the suggestions of Claude Code. This read did not confirm their destination.
  - A file edit "always" option is for "this session" only.
  - Aether stores no rule of its own in each case.
- Options:
  - A. Show each "always" option that the agent offers. Impact: the same choices as the native Claude apps; one click can add a permanent rule in the repository.
  - B. Hide the `allow-always` and `refuse-always` options in m1. Impact: no permanent rule from Aether; the user answers each tool again.
- More impact of A: a rule in the repository folder applies in each profile that opens the repository. Trust is per profile (S6), so this rule crosses the profile line.
- Recommendation: A, with the label of the agent, so the user sees the scope.
- Advisor: A. The preference patterns 3 (close a security gap) and 4 (keep the scope small) conflict here, so the advisor predicts that the user may disagree.

### 3. The status while a card shows

- User column: no.
- Hard to revert: no.
- Options:
  - A. No new status value. Waiting is `working` with a queue that is not empty. Impact: no change of the status contract; S9 needs no new value.
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

- User column: yes (permissions; bypass needs a user choice, decision 0007).
- Hard to revert: no.
- Facts:
  - In the mode Plan, the Claude adapter asks to exit the plan with options such as "Yes, and use auto mode" and "Yes, and bypass permissions". The adapter offers bypass by default.
  - Such an option changes the mode of the agent session. The adapter then sends `current_mode_update` (`exit-plan.js`). Aether ignores it today.
  - The Mode control of Aether then shows the saved mode, not the live mode.
  - `applySettings` sets the saved mode at each start. After a release (S9) or a restart, the session is in Plan again.
- Options:
  - A. Show these options as the agent offers them. Impact: the click is a user choice, as decision 0007 asks; the Mode control can show an old mode; a new process goes back to the saved mode.
  - B. Filter the bypass option in `providers/claude-code`. Impact: Aether never moves a session to bypass after the start; Aether needs Claude-specific option IDs.
  - C. A, and the Mode control shows the live mode of the agent, in memory only. Impact: the user sees the real mode; more scope in S5; a new process still goes back to the saved mode.
- Recommendation: A for m1. Record the old mode in the Mode control, and the return to the saved mode, as known gaps.
- Advisor: A for m1. "The click on a labelled option is the user choice that decision 0007 asks for." The preference patterns 3 and 4 conflict, so the advisor predicts that the user may disagree. It is a hot item.

### 6. A request with another ACP session ID

- User column: no (interface between modules).
- Hard to revert: no.
- Facts:
  - The code of the Claude adapter can send the request of a subagent with the session ID of the child session of that subagent. The owner session waits for it.
  - This read found the code path. It does not prove that the path runs for a client with the capabilities of Aether.
  - The S4 filter drops the updates of other session IDs. So such a card can have no tool entry for its title. The card then uses the title of the request.
- Options:
  - A. Accept each request on the connection of the process. Impact: subagent tools work; one process serves one Aether session (decision 0006), so no request reaches another session.
  - B. Answer `cancelled` for a session ID that is not the session of the process. Impact: each tool of a subagent that needs a permission fails.
- Recommendation: A.
- Advisor: A, after a second consultation with the adapter facts. Not hard to revert. The user likely agrees.

## Skim list

Small texts and details that the advisor accepted. The user can veto each one.

- The status text "Waiting for your answer".
- The button "Cancel request" for a request with no options.
- The card heading "Permission request".
