# Aether architecture

Status: baseline from step 0 of `docs/process.md`. The records in `docs/decisions/` give the reasons and the rejected alternatives.

## Stack

- Electron 45, with Node 24 inside, React 19, TypeScript 7, electron-vite and vitest.
- ACP (Agent Client Protocol) connects Aether to agents. Claude Code runs through the ACP adapter `@agentclientprotocol/claude-agent-acp`.
- SQLite through `node:sqlite` holds the saved data.

## Terms

| Term | Meaning |
|---|---|
| Workspace | One usage, for example personal work or one customer. It has a root directory, zero or one GitHub account, and zero or one Claude sign-in. |
| Claude sign-in | A Claude configuration folder (`CLAUDE_CONFIG_DIR`) and an optional profile name (`ANTHROPIC_PROFILE`). Aether stores no key and no token. |
| Repository | A Git repository under the root of a workspace. Aether finds it on disk and does not save it. |
| Session | One conversation with one agent in one workspace. It has a main directory and a list of additional directories. |
| Turn | One user message and the reply of the agent. |
| Entry | One saved item of a conversation: user text, agent text, thought, tool call, plan or notice. |
| Slice | One use case, from the UI to the saved data, in one folder. |
| Contract | The name, input schema, result and errors of one slice. |
| Agent process | One ACP adapter process and its Claude process, for one session. |

A project is a logical group of repositories in one workspace. Its meaning is an open point.

## Layout

The code is feature first. A slice is one folder. The file suffix names the zone of each file.

```text
src/
  app/
    main/               composition root, window, lifecycle
    preload/            the generic bridge
    renderer/           shell and navigation
    contracts.ts        registry of all contracts
  features/
    workspaces/
    sessions/
      session.ts                 aggregate, pure
      session.store.ts           persistence
      send-message/
        send-message.contract.ts
        send-message.controller.ts
        send-message.handler.ts
        send-message.ui.tsx
        send-message.test.ts
      create/  list/  open/  stop/  delete/
      answer-permission/
      record-agent-update/       event consumer
    repositories/
    agents/
  building-blocks/      result, contract, database, agent port, clock, ids, base UI
  providers/            acp, claude-code, git, github-cli
  database/migrations/  001-<name>.sql
tests/
  acceptance/
  architecture/
  simulated-agent/
```

| Suffix | Zone | Runs in |
|---|---|---|
| `.contract.ts` | shared | main and renderer |
| `.controller.ts`, `.handler.ts`, `.store.ts` | main | main process |
| `.ui.tsx` | renderer | renderer process |
| `<aggregate>.ts` | domain | anywhere; pure |

Rules from the template that apply:

- One use case is one slice. Commands and queries are separate slices.
- A use case never calls another use case.
- The domain is pure. Time and IDs come in as values.
- Expected failures return `Result`. A thrown error is a defect.
- Input is parsed at the first boundary.
- Controllers are thin.
- `building-blocks` holds technical code only.
- A port exists only at a real boundary: agent, database, Git, GitHub and clock.

Rules from the template that do not apply: a container for dependency injection, dispatchers, a unit of work, an outbox, and one file per type. `docs/process.md` replaces the template rules for approval and commits.

### Example slice: `send-message`

1. The controller validates the input against the contract.
2. The handler loads the session and calls `session.beginTurn()`.
3. The handler saves the session and calls the agent port.
4. The handler returns "accepted". It does not wait for the reply.
5. `record-agent-update` receives the progress of the agent and saves it.
6. The renderer receives the changes as events.

## Dependencies

- A slice imports only its own files, the root files of its feature, and `building-blocks`.
- A slice never imports another slice.
- `providers` implement ports from `building-blocks` and never import `features`.
- Only `app/main` connects providers to ports.
- Renderer code imports only contracts, renderer code and base UI.
- The domain imports nothing from Electron, Node or React.
- No import cycles.

## State

- The main process owns all state.
- The renderer keeps only view state: navigation, open dialogs and unsent text.
- The renderer does not use `localStorage` for data that must last.
- A query returns a snapshot. Events then carry only the change and a revision number.
- When the renderer sees a gap in the revisions, it loads a new snapshot.

## IPC and the renderer boundary

- The preload exposes only `invoke(name, input)` and `subscribe(name, callback)`. `subscribe` returns a function that stops the subscription.
- Both accept only names in the contract registry.
- The main process checks the sender frame and validates the input with zod.
- A slice returns `Result`. The main process logs a defect and returns a generic message.
- The renderer never sends a working directory with a message. The main process reads it from the session.
- No IPC call writes agent definitions.
- The main process denies the permission requests of web content.
- Links open only through the main process, and only for `https`.
- The renderer uses no raw HTML. The CSP stays.
- The sandbox and context isolation stay on.

A fully compromised renderer could still answer a permission question. These rules reduce that risk. They do not remove it.

## Saved data

- One SQLite database holds all saved data.
- Ordered SQL migrations change it. The database records its version in `user_version`.
- Aether copies the database before a migration and restores the copy if the migration fails.
- Aether refuses a database with a newer version.
- Aether never overwrites a database that it cannot read. It keeps it aside.
- Foreign keys are on. Each change is one transaction.
- Each conversation entry is one row with validated JSON.
- Streamed text is joined before it is saved.
- The old `workspace.json` and `runs/` are imported once and never changed.

## Workspaces

- A workspace owns its sessions.
- Each current account becomes a workspace at import. The user chooses its root.
- Two workspaces can use the same GitHub account.
- A session keeps the Claude sign-in that it started with. A later change applies to new sessions only.
- A session does not know its project. A later project refers to repositories and sessions.

## Directories and trust

The main process asks these questions, and stores the answers. The renderer cannot grant them.

| Case | Behavior |
|---|---|
| Session directory in a trusted repository | The session starts. |
| Repository under the root, first use | Aether asks for trust. It shows the hooks and MCP servers that it finds. |
| Directory outside the root | Aether asks: once, always for this workspace, or cancel. |
| Directory under the root of another workspace | Aether asks, and names both workspaces and the Claude sign-in that would read the files. |
| The agent reads or writes outside the session directories | Claude asks. Aether shows the request in the permission queue. |

- Trust applies to one repository, not to the whole root.
- No agent process starts before the trust answer. This includes an early start.
- "Approve all" also removes the last question in the table.
- After an approval, an agent shell command can reach any directory of the user.

## Agents

- The agent port in `building-blocks` is neutral. Only `providers/acp` imports the ACP library.
- `providers/claude-code` holds the launch recipe of Claude.
- Each active session has its own agent process.
- A session is idle when it has no active turn, no open permission question and no background task.
- An idle process closes after a release time. The release time is a setting, 30 minutes for a session that a person starts and 2 minutes for an automated session.
- Each session records who started it: a person or an automation.
- At most 6 idle processes stay open. Above that limit, the oldest idle process closes first. An active session never closes for this limit.
- Aether can start the process when the user opens a session and starts to type.
- The next message after a release resumes the session.
- A pure function with a clock decides the release.
- Shutdown sends cancel, closes the session, closes stdin, then kills the whole process tree after a limit.
- Processes and open questions live in memory only. A turn does not survive a restart of Aether.

### Agent environment

- Aether builds the environment of an agent process from an allow list.
- It sets the Claude variables from the workspace. It never passes on a Claude or Anthropic variable from its own environment.
- It sets `GH_TOKEN` to the token of the GitHub account of the workspace. The agent can read this token.

### Permissions

- Permission requests form a queue. Each request has its own ID.
- An answer names the request ID. Stop cancels all requests of the session.
- A cancelled request removes only itself from the queue.
- Aether sets the permission mode before the first message. Bypass is allowed only when the user chooses it.
- If the agent cannot apply the chosen mode, model or permission setting, the session does not start.
- A new session never copies "Approve all" from another session.

## Skills and MCP servers

| Layer | Content | Owner |
|---|---|---|
| Isolated | Skills, plugins, settings and user MCP servers in the Claude folder of the workspace | The Claude sign-in. Aether does not change it. |
| Shared | Skills and MCP servers in a library | Aether. Each workspace chooses its items. |

- Aether passes the shared items at session start.
- The agent port takes one neutral input: shared skills and MCP servers. Each provider translates it.
- Plugins are specific to Claude. Their skills and MCP servers can be shared.
- Aether never links or copies items between Claude folders.
- The library is not built now. "Customize" shows "coming soon".

## Projects and work items

- The UI shows "coming soon" for projects and work items.
- Their code is deleted. Git keeps it.

## Tests

| Layer | Scope | Tool | In CI |
|---|---|---|---|
| Unit | Domain and pure functions | vitest | Yes |
| Slice | Handler, real SQLite, simulated agent over real ACP | vitest | Yes |
| Contract | Valid and invalid examples of each contract | vitest | Yes |
| Architecture | The rules below | see below | Yes |
| Acceptance | The built app with the simulated agent | Playwright | Yes |
| Live | Real Claude | validator, per milestone | No |

- The simulated agent is a separate ACP program. It follows a script and waits at gates that the test controls. It uses no timers.
- Its scenarios: text, plan, tools, parallel permissions, slow start, crash, sign-in error, and a child process that outlives its parent.
- Tests register it in `agents.json` of a temporary data folder. The product has no test hook.
- Tests that use `node:sqlite` need Node 24.15 or later.

## Checkable rules

| Rule | Tool |
|---|---|
| No import between slices | dependency-cruiser with the swc parser |
| Renderer code imports no main code | dependency-cruiser |
| The domain is pure | dependency-cruiser |
| Providers import no features | dependency-cruiser |
| No import cycles | dependency-cruiser |
| No Node types in the renderer | one tsconfig per zone |
| No unhandled promises | oxlint with tsgolint |
| No restricted imports, storage or raw HTML | oxlint |
| Each contract is in the registry and has examples | vitest |
| Migrations are ordered and never change | vitest |
| Each slice folder has the expected files | vitest |

dependency-cruiser does not support TypeScript 7.0 with its TypeScript parser. The swc parser works. typescript-eslint and ArchUnitTS are rejected.

## Path from the current code

1. Milestone 0 builds the gates on the current code. Known violations go in a list that can only shrink.
2. Add contracts, the registry and the preload. Move the GitHub accounts query as the example slice.
3. Add SQLite, the import and the workspace slices.
4. Remove projects and work items.
5. Move the session slices and the renderer stores.
6. Build the agent port, the process per session and the permission queue. Write the two known risks as failing tests first.

Each step leaves a working app. Steps 3 to 6 are the first stories of the chat milestone.

These parts stay as they are: React, the visual design and CSS tokens, navigation, menus, the composer, mentions, the Git and GitHub wrappers, the window security settings, the single instance lock, and the custom agents file. New slices use CSS Modules.

## Known defects in the current code

| Defect | Place | Fixed in step |
|---|---|---|
| Two sessions that start at the same time share a process before it is ready. The second fails. | `src/main/agents/host.ts` | 6 |
| A second permission request cancels the first. | `src/main/agents/host.ts` | 6 |
| An unreadable conversation file loads as empty, and the next save overwrites it. | `src/main/agents/run-store.ts` | 3 |
| A new session copies "Approve all". | `SessionComposer.tsx` | 5 |
| Aether sets no permission mode. Claude then starts in `auto` mode with bypass allowed. | `src/main/agents/host.ts` | 6 |
| The agent receives the whole environment of Aether. | `src/main/agents/host.ts` | 6 |
| A repository runs its hooks and MCP servers at session start, without a question. | `src/main/agents/host.ts` | 6 |

## Open points

- Claude billing: subscription or Console account. See `docs/decisions/0011-claude-billing.md`.
- The meaning of a project: epic, milestone or other.
- Which Git identity and credentials `git push` and commits use in an agent session.
- Separation of two Console sign-ins with `ANTHROPIC_PROFILE`. Not tested with real accounts.
- Packaging and Electron fuses. The agent launch now needs the `runAsNode` fuse.
- A custom protocol instead of `file://`.
- macOS and Linux.
- ACP version 2.
- Playwright support for Electron is experimental. `node:sqlite` is a release candidate.
