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

/** One settings file or `.mcp.json` that exists in a folder, with the names of its other top-level keys. */
export interface FoundFile {
  /** The path of the file, relative to the folder that Aether scanned. */
  name: string
  /** The top-level keys other than the hooks and the MCP servers, which the findings list apart. */
  keys: string[]
}

/** What an agent reads in a folder before the user sees anything (decision 0007). */
export interface ProjectFindings {
  /** The command hooks of every event. */
  hooks: FoundHook[]
  mcpServers: FoundServer[]
  /** Each settings file and each `.mcp.json` that exists. A file counts also when it holds no hook and no server. */
  files: FoundFile[]
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

export const noFindings = (): ProjectFindings => ({ hooks: [], mcpServers: [], files: [], unreadable: [] })

/** True when the findings hold anything that the user must see. */
export const hasFindings = (findings: ProjectFindings): boolean =>
  findings.hooks.length > 0 || findings.mcpServers.length > 0 || findings.files.length > 0 || findings.unreadable.length > 0

/** The findings with each file name under a prefix, for the folder that holds them. */
export function prefixFindings(findings: ProjectFindings, prefix: string): ProjectFindings {
  if (prefix === '') return findings
  return {
    ...findings,
    files: findings.files.map((file) => ({ ...file, name: `${prefix}${file.name}` })),
    unreadable: findings.unreadable.map((name) => `${prefix}${name}`)
  }
}

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
    for (const file of findings.files) add(merged.files, file, 'file')
    for (const name of findings.unreadable) add(merged.unreadable, name, 'unreadable')
  }
  return merged
}
