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
