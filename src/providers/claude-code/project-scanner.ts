import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FoundFile, FoundHook, FoundServer, ProjectFindings, ProjectScanner } from '../../building-blocks/project-scanner.port'

const CLAUDE_FOLDER = '.claude'
/** `settings.json`, `settings.local.json` and any other `settings*.json`. */
const SETTINGS_FILE = /^settings.*\.json$/i
const SERVERS = '.mcp.json'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const codeOf = (cause: unknown) => (cause as NodeJS.ErrnoException).code

const isMissing = (cause: unknown) => codeOf(cause) === 'ENOENT' || codeOf(cause) === 'ENOTDIR'

/** The JSON object of a file. `unreadable` for a file that Aether cannot use. */
async function readObject(path: string): Promise<{ state: 'ok'; value: Record<string, unknown> } | { state: 'missing' | 'unreadable' }> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (cause) {
    return { state: isMissing(cause) ? 'missing' : 'unreadable' }
  }
  try {
    const value: unknown = JSON.parse(text.replace(/^﻿/, ''))
    return isObject(value) ? { state: 'ok', value } : { state: 'unreadable' }
  } catch {
    return { state: 'unreadable' }
  }
}

/** The command hooks of every event, in the order of the file. */
function hooksOf(settings: Record<string, unknown>): FoundHook[] {
  const found: FoundHook[] = []
  if (!isObject(settings.hooks)) return found
  for (const [event, groups] of Object.entries(settings.hooks)) {
    for (const group of Array.isArray(groups) ? groups : []) {
      const hooks: unknown = isObject(group) ? group.hooks : undefined
      for (const hook of Array.isArray(hooks) ? hooks : []) {
        if (isObject(hook) && hook.type === 'command' && typeof hook.command === 'string') {
          found.push({ event, command: hook.command })
        }
      }
    }
  }
  return found
}

function serversOf(file: Record<string, unknown>): FoundServer[] {
  if (!isObject(file.mcpServers)) return []
  return Object.entries(file.mcpServers).map(([name, server]) => {
    const command = isObject(server) && typeof server.command === 'string' ? server.command : null
    const args = isObject(server) && Array.isArray(server.args) ? server.args.map(String) : []
    return { name, command: command === null ? null : [command, ...args].join(' ') }
  })
}

/**
 * The top-level keys of a file by name. The key that the findings list apart (`hooks`, `mcpServers`)
 * stays in the list when the scan lists nothing from it, so that no value hides in the file.
 */
const otherKeys = (file: Record<string, unknown>, listed: string, listedCount: number): string[] =>
  Object.keys(file).filter((key) => key !== listed || listedCount === 0)

/**
 * Finds what Claude Code reads without a question when a session starts in a folder (decision 0007):
 * each `.claude/settings*.json` file, with its hooks of every event and the names of its other keys,
 * and `.mcp.json`, with its servers. A file counts when it exists, also when it is empty. It reads
 * files and runs nothing. A file that exists but does not parse is reported, never ignored: Claude
 * can still read what Aether cannot.
 */
export class ClaudeProjectScanner implements ProjectScanner {
  async scan(folder: string): Promise<ProjectFindings> {
    const findings: ProjectFindings = { hooks: [], mcpServers: [], files: [], unreadable: [] }
    const found = (name: string, file: FoundFile) => findings.files.push({ ...file, name })

    let names: string[] = []
    try {
      names = (await readdir(join(folder, CLAUDE_FOLDER))).filter((name) => SETTINGS_FILE.test(name)).sort()
    } catch (cause) {
      if (!isMissing(cause)) findings.unreadable.push(CLAUDE_FOLDER)
    }
    for (const name of names) {
      const path = join(CLAUDE_FOLDER, name)
      const settings = await readObject(join(folder, path))
      if (settings.state === 'ok') {
        const hooks = hooksOf(settings.value)
        findings.hooks.push(...hooks)
        found(path, { name: path, keys: otherKeys(settings.value, 'hooks', hooks.length) })
      } else if (settings.state === 'unreadable') findings.unreadable.push(path)
    }

    const servers = await readObject(join(folder, SERVERS))
    if (servers.state === 'ok') {
      const listed = serversOf(servers.value)
      findings.mcpServers.push(...listed)
      found(SERVERS, { name: SERVERS, keys: otherKeys(servers.value, 'mcpServers', listed.length) })
    } else if (servers.state === 'unreadable') findings.unreadable.push(SERVERS)
    return findings
  }
}
