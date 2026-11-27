# 0007 Permissions, trust and the agent environment

Date: 2026-11-25
Decided by: the user, on a proposal of the architecture session (step 0).
Status: accepted

## Context

Claude in SDK mode shows no trust question. A test showed that a repository runs its `SessionStart` hooks and project MCP servers at session start, without a question. Today Aether sets no permission mode, so Claude started in `auto` mode with bypass allowed. A fake `CLAUDE_CODE_OAUTH_TOKEN` in the environment passed the subscription guard of the adapter.

## Decision

- Aether asks for trust once per repository, before any agent process starts in it.
- Aether asks, and does not refuse, for a directory outside the root.
- For a directory under the root of another workspace, the question names both workspaces.
- Only the main process stores trust answers.
- Permission requests form a queue with one ID per request.
- Aether sets the permission mode before the first message. Bypass needs a user choice.
- A session that cannot apply its settings does not start.
- A new session never copies "Approve all".
- Aether builds the agent environment from an allow list.
- Aether sets `GH_TOKEN` to the token of the workspace GitHub account. The agent can read it.

## Rejected

- Trust for the whole root. A cloned repository under the root could run its hooks without a question.
- Refusal of directories outside the root. The native Claude apps ask instead.

## Note of 2026-11-27

Decided by the user, during story S6 of milestone m1-chat. The text above stays as it was. This note refines it.

- Trust answers belong to one profile. Trust of a repository in one profile does not trust it in another. Migration `003` stores them.
- A plain folder asks for trust when it has any `.claude/settings*.json` file or any `.mcp.json` file. This includes `settings.local.json`, any hook event and any key. A plain folder without them starts at once.
- A Git repository always asks. The question lists the hooks by event and command, the MCP servers and the other keys by name. It reads the repository root and the session directory.
- The most specific workspace directory wins. With profile A at `X` and profile B at `X\client`, a session of A in `X\client` gets the question for another profile.
- Aether walks up from the session directory, also past the workspace directory, to find `.git`. Trust covers that repository.
- "Allow once" covers one session. "Always allow for this profile" covers that folder for that profile, also after a restart.
- The question for another profile offers "Allow once", "Always allow for this profile" and "Cancel".
- Known limit: trust stays after the files change. A hook that a later commit adds runs without a new question.

## Note of 2026-11-27, trust and the workspace directory

Decided by the user, during story S5 of milestone m1-chat. The decision and the rejected alternatives stay as they were.

- The walk up from the session directory squares with the rejected alternative "Trust for the whole root". Aether still never trusts the root without a question. It trusts one repository.
- A repository above the workspace directory covers that directory by containment. The question names the repository root before the user answers.
- When the root holds the workspace directory, the question warns: "Trust covers every plain folder under <workspace directory> for the profile <name>."
- The warning does not show for a repository inside the workspace directory.
