import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { delimiter, dirname, isAbsolute, join } from 'node:path'
import type { AgentInfo } from '../../shared/agent'

/** How to start an ACP agent: a program that speaks ACP on stdin and stdout. */
export interface AgentDefinition {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  /** What to tell the user when the agent says that nobody is signed in. */
  signInHint?: string
}

export interface ResolvedAgent extends AgentDefinition {
  available: boolean
  detail: string
}

const require = createRequire(__filename)

/**
 * Claude Code, through the ACP adapter that Aether ships with. The adapter
 * runs the Claude Code that comes with it, signed in the way Claude Code is
 * signed in on this machine.
 *
 * `--hide-claude-auth` keeps Aether off claude.ai subscriptions: Anthropic does
 * not allow other products to use them. Claude Code then runs on an API key
 * (ANTHROPIC_API_KEY) or an Anthropic Console sign-in.
 */
function claudeCode(): ResolvedAgent {
  const base = {
    id: 'claude-code',
    name: 'Claude Code',
    signInHint:
      'Set ANTHROPIC_API_KEY before you start Aether, or sign in with an Anthropic Console account: ' +
      'run `claude auth login --console` in a terminal ' +
      '(without Claude Code installed: `npx @agentclientprotocol/claude-agent-acp --cli auth login --console`).'
  }
  let script: string
  try {
    script = join(dirname(require.resolve('@agentclientprotocol/claude-agent-acp/package.json')), 'dist/index.js')
  } catch {
    return { ...base, command: '', args: [], env: {}, available: false, detail: 'The Claude Code adapter is not installed.' }
  }
  return {
    ...base,
    // Electron runs the adapter as plain Node, so the user needs no Node install.
    command: process.execPath,
    args: [script, '--hide-claude-auth'],
    env: { ELECTRON_RUN_AS_NODE: '1' },
    available: true,
    detail: 'Built in'
  }
}

interface CustomAgentFile {
  agents?: unknown
}

function isDefinition(value: unknown): value is Omit<AgentDefinition, 'env' | 'args'> & Partial<AgentDefinition> {
  if (typeof value !== 'object' || value === null) return false
  const agent = value as Record<string, unknown>
  return (
    typeof agent.id === 'string' &&
    /^[\w-]{1,64}$/.test(agent.id) &&
    typeof agent.name === 'string' &&
    typeof agent.command === 'string' &&
    (agent.args === undefined || (Array.isArray(agent.args) && agent.args.every((arg) => typeof arg === 'string'))) &&
    (agent.env === undefined || (typeof agent.env === 'object' && agent.env !== null))
  )
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Finds a program the way a shell does, so that `gemini` finds the installed CLI. */
async function findProgram(command: string): Promise<string | null> {
  if (isAbsolute(command)) return (await isExecutable(command)) ? command : null
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const folder of (process.env.PATH ?? '').split(delimiter)) {
    if (!folder) continue
    for (const extension of extensions) {
      const candidate = join(folder, command + extension)
      if (await isExecutable(candidate)) return candidate
    }
  }
  return null
}

/**
 * The agents Aether knows: Claude Code, and the agents in `agents.json` in the
 * data folder. Any program that speaks ACP can be added there, for example:
 *
 *   { "agents": [{ "id": "gemini", "name": "Gemini CLI", "command": "gemini", "args": ["--acp"] }] }
 *
 * Check each agent's documentation for the arguments that start its ACP mode.
 */
export class AgentRegistry {
  constructor(private readonly customFile: string) {}

  async list(): Promise<ResolvedAgent[]> {
    const agents: ResolvedAgent[] = [claudeCode()]
    for (const custom of await this.readCustom()) {
      if (agents.some((agent) => agent.id === custom.id)) continue
      const program = await findProgram(custom.command)
      agents.push({
        id: custom.id,
        name: custom.name,
        command: program ?? custom.command,
        args: custom.args ?? [],
        env: Object.fromEntries(
          Object.entries(custom.env ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        ),
        signInHint: typeof custom.signInHint === 'string' ? custom.signInHint : undefined,
        available: program !== null,
        detail: program ?? `Cannot find ${custom.command}`
      })
    }
    return agents
  }

  async get(id: string): Promise<ResolvedAgent | undefined> {
    return (await this.list()).find((agent) => agent.id === id)
  }

  async info(): Promise<AgentInfo[]> {
    return (await this.list()).map(({ id, name, available, detail }) => ({ id, name, available, detail }))
  }

  private async readCustom() {
    let data: CustomAgentFile
    try {
      data = JSON.parse(await readFile(this.customFile, 'utf8')) as CustomAgentFile
    } catch {
      return []
    }
    return Array.isArray(data.agents) ? data.agents.filter(isDefinition) : []
  }
}
