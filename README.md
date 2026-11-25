# aether

A desktop workspace for projects, work items, and the coding agents that work on them.

## Agents

Aether runs coding agents through the [Agent Client Protocol](https://agentclientprotocol.com) (ACP).
It has no agent of its own and is not tied to one vendor: each agent is a program that speaks ACP on
stdin and stdout, and Aether shows what it does and asks you before it uses a tool.

Each work item has its own conversation with an agent. The agent works in the project's folder, and
the conversation continues where it stopped, also after a restart of Aether.

### Claude Code

Claude Code is built in, through the [Claude Agent ACP adapter](https://www.npmjs.com/package/@agentclientprotocol/claude-agent-acp).
Aether starts the adapter with `--hide-claude-auth`, because Anthropic does not allow other products to
use claude.ai subscriptions. Claude Code in Aether therefore runs on one of these:

- an API key: start Aether with `ANTHROPIC_API_KEY` set
- an Anthropic Console account: run `claude auth login --console` once

### Other agents

Add any ACP agent in `agents.json` in Aether's data folder (`AETHER_DATA_DIR` when set):

```json
{
  "agents": [
    { "id": "gemini", "name": "Gemini CLI", "command": "gemini", "args": ["--acp"] }
  ]
}
```

`command` is found on `PATH` like in a shell. Check each agent's documentation for the arguments
that start its ACP mode. `env` (an object) and `signInHint` (shown when the agent says nobody is
signed in) are optional.

## Try it

```sh
npm install
ANTHROPIC_API_KEY=... npm run dev
```

1. Create a project and choose its folder. Use a test folder or a Git repository with a clean tree.
2. Describe a work item, open it, and press **Start with this work item**, or write a message.
3. Allow or reject each tool call when the agent asks.

## Development

```sh
npm test         # unit tests, and an ACP test agent driven over stdio
npm run typecheck
npm run build
```
