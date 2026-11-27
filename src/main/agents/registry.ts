import { constants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { delimiter, isAbsolute, join } from 'node:path'
import { err, ok, type Result } from '../../building-blocks/result'

/** How to start an ACP agent: a program that speaks ACP on stdin and stdout. */
export interface AgentDefinition {
  id: string
  name: string
  command: string
  args?: string[]
}

export interface ResolvedAgent extends Omit<AgentDefinition, 'args'> {
  args: string[]
  available: boolean
  detail: string
}

/**
 * The id of the Claude Code recipe. An entry with this id in `agents.json` replaces only the program
 * and the arguments of that recipe. Everything else stays with the Claude provider.
 */
export const CLAUDE_CODE_ID = 'claude-code'

interface CustomAgentFile {
  agents?: unknown
}

function isDefinition(value: unknown): value is AgentDefinition {
  if (typeof value !== 'object' || value === null) return false
  const agent = value as Record<string, unknown>
  return (
    typeof agent.id === 'string' &&
    /^[\w-]{1,64}$/.test(agent.id) &&
    typeof agent.name === 'string' &&
    typeof agent.command === 'string' &&
    (agent.args === undefined || (Array.isArray(agent.args) && agent.args.every((arg) => typeof arg === 'string')))
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
 * The agents in `agents.json` in the data folder. Aether only reads this file: no call of the
 * renderer writes it (architecture, IPC). Any program that speaks ACP can be added, for example:
 *
 *   { "agents": [{ "id": "gemini", "name": "Gemini CLI", "command": "gemini", "args": ["--acp"] }] }
 *
 * Only the entry `claude-code` has an effect in this version: it replaces the program and the
 * arguments of the Claude Code recipe. Check each agent's documentation for the arguments that
 * start its ACP mode.
 */
export class AgentRegistry {
  constructor(private readonly customFile: string) {}

  /** The valid entries of the file. A missing or unreadable file gives an empty list. The program of an entry is resolved on PATH. */
  async list(): Promise<ResolvedAgent[]> {
    const agents: ResolvedAgent[] = []
    for (const custom of await this.readCustom()) {
      // The first entry of an id wins.
      if (agents.some((agent) => agent.id === custom.id)) continue
      const program = await findProgram(custom.command)
      agents.push({
        id: custom.id,
        name: custom.name,
        command: program ?? custom.command,
        args: custom.args ?? [],
        available: program !== null,
        detail: program ?? `Cannot find ${custom.command}`
      })
    }
    return agents
  }

  async get(id: string): Promise<ResolvedAgent | undefined> {
    return (await this.list()).find((agent) => agent.id === id)
  }

  /**
   * The replacement of the launch recipe of Claude Code: null when the file has no entry
   * `claude-code`. An entry whose program does not exist is an error, never a silent fall back to the
   * built-in Claude. The message names the entry, so the notice of the session says what to fix.
   */
  async claudeCodeOverride(): Promise<Result<{ command: string; args: string[] } | null>> {
    const entry = await this.get(CLAUDE_CODE_ID)
    if (!entry) return ok(null)
    if (!entry.available) {
      return err(
        'override-unavailable',
        `The entry "${CLAUDE_CODE_ID}" in agents.json names a program that Aether cannot find: ${entry.command}. Fix the entry or remove it.`
      )
    }
    return ok({ command: entry.command, args: entry.args })
  }

  private async readCustom(): Promise<AgentDefinition[]> {
    let data: CustomAgentFile
    try {
      data = JSON.parse(await readFile(this.customFile, 'utf8')) as CustomAgentFile
    } catch {
      return []
    }
    return Array.isArray(data.agents) ? data.agents.filter(isDefinition) : []
  }
}
