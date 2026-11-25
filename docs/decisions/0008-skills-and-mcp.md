# 0008 Isolated and shared skills and MCP servers

Date: 2026-11-25
Decided by: the user, on a proposal of the architecture session (step 0).
Status: accepted

## Context

The user wants each Claude account isolated, and also wants to share items between accounts and agents. A test showed that a skill in one Claude folder is not visible in another one. A skill and an MCP server that Aether passes at session start are visible.

## Decision

- The Claude folder of the workspace holds its isolated items. Aether does not change it.
- Aether will own a library of shared skills and MCP servers. Each workspace chooses its items.
- The agent port takes shared skills and MCP servers as one neutral input. Each provider translates it.
- The library is not built now.

## Rejected

- Links or copies between Claude folders. They break the isolation.
