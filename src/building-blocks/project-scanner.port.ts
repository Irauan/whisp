/** One command that the agent runs at the start of a session, for example a `SessionStart` hook. */
export interface FoundHook {
  /** The event, for example `SessionStart`. */
  event: string
  command: string
}

/** One MCP server that the agent starts for a folder. */
export interface FoundServer {
  name: string
  /** The command line of the server, or null when the entry names none. */
  command: string | null
}

/** What an agent would run in a folder before the user sees anything (decision 0007). */
export interface ProjectFindings {
  hooks: FoundHook[]
  mcpServers: FoundServer[]
  /** The files that exist but that Aether could not read. The agent can still read them. */
  unreadable: string[]
}

/**
 * The boundary that finds what an agent runs by itself in a folder. The port is neutral: a
 * provider knows where its agent keeps hooks and MCP servers. It reads files only, and runs nothing.
 */
export interface ProjectScanner {
  scan(folder: string): Promise<ProjectFindings>
}

export const noFindings = (): ProjectFindings => ({ hooks: [], mcpServers: [], unreadable: [] })

/** True when the findings hold anything that the user must see. */
export const hasFindings = (findings: ProjectFindings): boolean =>
  findings.hooks.length > 0 || findings.mcpServers.length > 0 || findings.unreadable.length > 0

/** The findings of several folders as one list, without repeats. */
export function mergeFindings(...all: ProjectFindings[]): ProjectFindings {
  const merged = noFindings()
  const seen = new Set<string>()
  const add = <Item>(list: Item[], item: Item, kind: string) => {
    const key = `${kind}\u0000${JSON.stringify(item)}`
    if (seen.has(key)) return
    seen.add(key)
    list.push(item)
  }
  for (const findings of all) {
    for (const hook of findings.hooks) add(merged.hooks, hook, 'hook')
    for (const server of findings.mcpServers) add(merged.mcpServers, server, 'server')
    for (const name of findings.unreadable) add(merged.unreadable, name, 'unreadable')
  }
  return merged
}
