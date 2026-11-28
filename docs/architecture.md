# Aether architecture

Status: baseline from step 0 of `docs/process.md`. The records in `docs/decisions/` give the reasons and the rejected alternatives.

## Stack

- Electron 45, with Node 24 inside, React 19, TypeScript 7, electron-vite and vitest.
- ACP (Agent Client Protocol) connects Aether to agents. Claude Code runs through the ACP adapter `@agentclientprotocol/claude-agent-acp`.
- SQLite through `node:sqlite` holds the saved data.

## Terms

| Term | Meaning |
|---|---|
| Profile | One usage, for example personal work or one customer. It has a workspace directory, zero or one GitHub account, and zero or more providers. |
| Workspace directory | The folder of a profile that holds its repositories. |
| Provider | One account that runs agents, with its settings and a label. A profile can have many, also of one kind. One account of each kind is current for new sessions. The kind `claude-code` is the only one now. Aether stores no key and no token. |
| Agent session | One agent run of a session, with one provider and the ID that the agent gave to it. A resume uses the provider of its row. |
| Claude settings | The settings of the provider `claude-code`: a Claude configuration folder (`CLAUDE_CONFIG_DIR`). A Claude account is only its folder (decision 0013). |
| Repository | A Git repository under the workspace directory of a profile. Aether finds it on disk and does not save it. |
| Session | One conversation with one agent in one profile. It has a source path, a main directory and a list of additional directories. |
| Turn | One user message and the reply of the agent. |
| Entry | One saved item of a conversation: user text, agent text, thought, tool call, plan or notice. |
| Slice | One use case, from the UI to the saved data, in one folder. |
| Contract | The name, input schema, result and errors of one slice. |
| Agent process | One ACP adapter process and its Claude process, for one session. |

A project is a logical group of repositories in one profile. Its meaning is an open point.

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
    profiles/
    sessions/
      session.ts                 aggregate, pure
      session.store.ts           persistence
      send-message/
        send-message.contract.ts
        send-message.controller.ts
        send-message.handler.ts
        send-message.ui.tsx
        send-message.test.ts
      create/  list/  open/  stop/  delete/  rename/  set-mode/  set-model/
      answer-permission/
      record-agent-update/       event consumer (handler and test, no contract)
      entry.ts                   entries and events, pure
      transcript.store.ts        the conversation in memory and in the database
      processes.store.ts         the agent process and the turn of each session
    repositories/
    agents/
  building-blocks/      result, contract, database, agent port, agent environment, accounts in start, clock, ids, base UI
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
- `AccountsInStart` is in `building-blocks`. It is shared in-memory state of two features: `sessions` starts an account, and `profiles` reads it when it edits an account. The composition root creates one instance and wires it to both.
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
- The event `sessions.changed` carries one change of one session and its revision. The revision counts from 1 in memory, and it starts again after a restart.
- `sessions.open` returns the snapshot: the session, its entries, its status and its revision. The renderer subscribes before it opens, and drops the events at or below the revision of the snapshot.

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
- The import reads the accounts and the sessions of the old `workspace.json` once. It never changes the old `workspace.json` or `runs/` (decision 0005).

## Profiles

Decision 0013 records this model.

- A profile owns its providers and its sessions.
- Each current account becomes a profile at import. The user chooses its workspace directory.
- The import creates no provider row, because the old accounts had no Claude settings.
- Decision 0014 gives the provider model: many accounts for each profile, one current account for each kind, and the table `agent_sessions`.
- Two profiles can use the same GitHub account. The login of the account chooses `GH_TOKEN`.
- A provider row holds a kind and settings as JSON. Aether validates the settings for the kind before it saves them.
- A session has a nullable provider. It is null until the first start. The first start reads the current account of the profile at that moment, and saves it in the session and in the agent run. A session never keeps an account from its creation.
- The table `agent_sessions` has one row for each agent run. Aether saves it, in one transaction, when the agent session exists. The row names the provider that the process started with and the agent session ID. A resume uses that provider. Milestone m1-chat has one row for each session.
- The first start creates an empty current account when the profile has none. A failed first start keeps this account and saves no agent run. The retry reads the current account again, so it uses the account that the user fixed.
- An account that a first start uses counts as used until the start ends, because no agent run names it before the process is ready. An edit in that time makes a new current account. The set of these accounts lives in memory. The account that an agent run names always holds the settings that its process started with.
- A trigger locks the Claude folder of an account that an agent run used. The label stays editable.
- "Profile settings" edits the current Claude account. An account that no agent run used changes in place. For a used account, a change of the settings makes a new current account, or makes the account with the same settings current. The old account stays for its agent runs. A change applies to new sessions only.
- A session has a source path: the repository or folder that it started from. The sidebar groups sessions by it.
- A session does not know its project. A later project refers to repositories and sessions.

## Directories and trust

The main process asks these questions, and stores the answers. The renderer cannot grant them.

| Case | Behavior |
|---|---|
| Session directory in a trusted repository | The session starts. |
| Repository under the workspace directory, first use | Aether asks for trust. It shows the settings, hooks and MCP servers that it finds. |
| Directory outside the workspace directory | Aether asks: once, always for this profile, or cancel. |
| Directory under the workspace directory of another profile | Aether asks, and names both profiles and the Claude settings that would read the files. |
| The agent reads or writes outside the session directories | Claude asks. Aether shows the request in the permission queue. |

- Trust applies to one Git repository. When the root of that repository holds the workspace directory, trust covers every plain folder under the workspace directory for that profile, and the question warns.
- Aether walks up from the session directory, also past the workspace directory, to find `.git`. Trust covers that repository.
- A Git repository always asks. A plain folder asks when it has any `.claude/settings*.json` file or any `.mcp.json` file. A plain folder without them starts at once.
- The question lists what Aether found in the repository root and in the session directory.
  - Hooks of every event, by event and command.
  - MCP servers.
  - The other keys of each settings file, by name.
- The most specific workspace directory wins. With profile A at `X` and profile B at `X\client`, a session of A in `X\client` gets the question for another profile.
- Answers belong to one profile. Trust of a repository in one profile does not trust it in another.
- "Allow once" covers one session and lives in memory. "Always allow for this profile" covers that folder and stays after a restart.
- The question for another profile offers the same answers as the question for a directory outside.
- A directory question also lists what Aether finds in the folder. No second question follows.
- Trust stays after the files change. This is a known limit: a hook that a later commit adds runs without a new question.
- Before it compares paths, Aether resolves `..`, junctions and symbolic links. On Windows it ignores the letter case.
- A UNC path is outside every workspace directory. Aether does not read it before the answer. A profile without a workspace directory has every folder outside.
- The feature `repositories` holds the questions and the answers (migration `003`).
- `send-message` calls the gate through a function that the composition root passes.
- Stop, delete and quit answer `cancel`. A cancel during the scan of the folder opens no question.
- No agent process starts before the trust answer. This includes an early start and a resume.
- "Approve all" also removes the last question in the table.
- After an approval, an agent shell command can reach any directory of the user.

## Agents

- The agent port in `building-blocks` is neutral. Only `providers/acp` imports the ACP library.
- `providers/claude-code` holds the launch recipe of Claude.
- Each active session has its own agent process.
- The port starts a process at once and returns a handle. The handle has `ready`, `prompt`, `cancel` and `close`. Stop in the state Starting cancels the start.
- The start input holds the main directory, the additional directories, the model, the mode, the shared items, the settings of the provider account of the run, the environment, and the agent session to resume. The caller reads it from the session row, never from the renderer.
- The additional directories are the `folder` attachments outside the session folder, as real paths. Each start asks the directory and trust questions for the main directory, then for each additional directory, one after the other. The first message holds one link for each file or folder attachment, and the URL of each issue or pull request as text. `providers/acp` turns each link into a `resource_link`. A resume sends no link.
- If the agent cannot resume a session, `providers/acp` starts a new agent session. Aether then shows a notice.
- `providers/claude-code` also holds the sign-in steps and the reader of the settings. The sign-in is the Claude subscription, and Aether never passes `--hide-claude-auth` (decision 0011). An entry `claude-code` in `agents.json` replaces only the program and the arguments of its launch recipe. If that program does not exist, the start fails with a notice that names the entry. Aether never falls back to the built-in program without a word. No call of the renderer writes `agents.json`.
- A session is idle when it has no active turn, no open permission question and no background task.
- An idle process closes after a release time. The release time is 30 minutes for a session that a person starts and 2 minutes for an automated session. User decision 2026-11-27 (S9 choice 2A): the release times are constants in m1 (`RELEASE_LIMITS`), not settings.
- Each session records who started it: a person or an automation.
- At most 6 idle processes stay open. Above that limit, the oldest idle process closes first. An active session never closes for this limit.
- Aether can start the process when the user opens a session and starts to type.
- The next message after a release resumes the session.
- A pure function with a clock decides the release.
- Shutdown sends cancel, closes the session, closes stdin, then kills the whole process tree after a limit.
- A background shell command of the agent does not count as busy. It ends with its process after the release time. The user accepted this gap against decision 0006 on 2026-11-27. A background subagent holds the turn open, so it counts.
- A close sends the cancel and lists the process tree in one step, before it closes the session and stdin. It checks that the root of the list started when the agent started. After the agent ends, it kills each listed process that still runs, and checks the start time of each one first.
- On Windows the list uses PowerShell and takes about 0.9 s for one close, measured on a developer machine. The closes of many processes run together, so a quit with 7 processes takes about 1.4 s, and the removal of a profile with 6 sessions about 1.3 s. Each PowerShell call and `taskkill` has a limit of 5 s.
- When the list fails or times out, Aether logs it and ends the agent and its whole tree with `taskkill /T /F` at once, while the agent still runs, so that `/T` finds the children. The kill runs only if the agent has not ended when the list ends: its number can belong to another process by then, so Aether logs this case and kills nothing. It skips the close of the session and of stdin. User decision 2026-11-27. The process still counts as closed for the next start.
- Two cases still escape the kill of the tree: a crash of the agent, and a child that starts after the list.
- Processes and open questions live in memory only. A turn does not survive a restart of Aether.

### Agent environment

- Aether builds the environment of an agent process from an allow list.
- The allow list is `ALLOWED_VARIABLES` in `src/building-blocks/agent-environment.ts`. It holds the Windows basics, the proxy settings and the certificate settings. Names match without case.
- It sets `CLAUDE_CONFIG_DIR` from the settings of the Claude account of the agent run. It never passes on a Claude, Anthropic, GH or GitHub variable from its own environment.
- It sets `GH_TOKEN` to the token of the GitHub account of the profile. The agent can read this token.
- Aether reads the token with `gh auth token --hostname github.com --user <login>`, without the token variables of its own environment. It never saves or logs the token. Every notice and log tail that Aether saves hides the values that Aether gave the agent.

### Permissions

- Permission requests form a queue. Each request has its own ID.
- An answer names the request ID. Stop cancels all requests of the session.
- A cancelled request removes only itself from the queue.
- Each open request shows as a card inside the transcript, at the place where the agent asked. The queue lives in memory only.
- Aether saves each card as an `answers` entry when it opens, and replaces the entry in place when the card closes. A card that was open at a crash shows as "Aether stopped unexpectedly" at the next start.
- A question of the agent (a form elicitation, for example AskUserQuestion) shows as a card in the same way. Aether declares the form capability only.
- A request can come outside a turn. A session with an open card is busy, and it blocks a new message.
- The agent can change its mode, for example at a plan exit. The Mode control shows it at once, and Aether saves it, except Approve all and the mode of the fallback of Auto.
- Aether sets the permission mode before the first message. Bypass is allowed only when the user chooses it.
- The Mode control and the model button of a draft save the mode and the model in the session row (`sessions.set-mode`, `sessions.set-model`). After the first message both are disabled.
- If the agent cannot apply the chosen mode, model or permission setting, the session does not start. Aether keeps no list of valid models in the main process: the agent refuses a model that it does not know, and the session shows a start notice.
- A model that cannot use Auto makes Claude use Accept edits. The agent reports it, and the session shows a notice that names both modes.
- `sessions.send-message` refuses an attachment of an unknown kind and a session attachment before any agent process starts.
- A new session never copies "Approve all" from another session.

### Session title

- The first line of the first message is the first title (`titleOf`). The agent can name the session later: the port update `title` comes from `session_info_update` with a string title.
- Each title passes through `titleOf` (first line, cut at 100 characters). A blank title, a title equal to the saved one, and a title for a deleted session change nothing.
- `sessions.title_source` (migration 005) says where the title comes from: `prompt`, `agent` or `user`. The store validates it in code. A title of the agent never replaces a title with the source `user`. `sessions.rename` sets the source `user`, and it refuses a draft.
- The store saves the title first. The event `title` of `sessions.changed` goes out only after a successful save. The window applies it. The sidebar loads a new snapshot of the sessions when a `title` event comes, for any session.
- The title and the menu "Session options" are in the title strip of the shell. A draft shows "New session" and the item "Discard draft".

## Skills and MCP servers

| Layer | Content | Owner |
|---|---|---|
| Isolated | Skills, plugins, settings and user MCP servers in the Claude folder of the profile | The Claude provider settings. Aether does not change it. |
| Shared | Skills and MCP servers in a library | Aether. Each profile chooses its items. |

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
3. Add SQLite, the import and the profile slices.
4. Remove projects and work items.
5. Move the session slices and the renderer stores.
6. Build the agent port, the process per session and the permission queue. Write the two known risks as failing tests first.

Each step leaves a working app. Steps 3 to 6 are the first stories of the chat milestone.

These parts stay as they are: React, the visual design and CSS tokens, navigation, menus, the composer of a new session, mentions, the Git and GitHub wrappers, the window security settings, the single instance lock, and the custom agents file (`agents.json`, read only). New slices use CSS Modules.

The session window is a fixed frame (story S8). It has the header, the transcript and the bottom dock. The transcript is the only scroll area. The dock holds the status line, the plan widget and the composer.

The composer of the session window follows the composer of the GitHub app. Its control row sits inside the box.

A plan update that only changes the states replaces the latest plan entry in place.

## Known defects in the current code

None.

## Open points

- The meaning of a project: epic, milestone or other.
- Which Git identity and credentials `git push` and commits use in an agent session.
- Packaging and Electron fuses. The agent launch now needs the `runAsNode` fuse.
- A custom protocol instead of `file://`.
- macOS and Linux.
- ACP version 2.
- Playwright support for Electron is experimental. `node:sqlite` is a release candidate.
