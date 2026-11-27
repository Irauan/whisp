import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FoundHook, FoundServer, ProjectFindings, ProjectScanner } from '../../building-blocks/project-scanner.port'

/** The event that S6 guards (user decision, 2026-11-27). */
const SESSION_START = 'SessionStart'

const SETTINGS = join('.claude', 'settings.json')
const SERVERS = '.mcp.json'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The JSON object of a file. `missing` for no file, `unreadable` for a file that Aether cannot use. */
async function readObject(path: string): Promise<{ state: 'ok'; value: Record<string, unknown> } | { state: 'missing' | 'unreadable' }> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (cause) {
    return { state: (cause as NodeJS.ErrnoException).code === 'ENOENT' || (cause as NodeJS.ErrnoException).code === 'ENOTDIR' ? 'missing' : 'unreadable' }
  }
  try {
    const value: unknown = JSON.parse(text.replace(/^﻿/, ''))
    return isObject(value) ? { state: 'ok', value } : { state: 'unreadable' }
  } catch {
    return { state: 'unreadable' }
  }
}

function hooksOf(settings: Record<string, unknown>): FoundHook[] {
  const groups = isObject(settings.hooks) ? settings.hooks[SESSION_START] : undefined
  const found: FoundHook[] = []
  for (const group of Array.isArray(groups) ? groups : []) {
    const hooks: unknown = isObject(group) ? group.hooks : undefined
    for (const hook of Array.isArray(hooks) ? hooks : []) {
      if (isObject(hook) && hook.type === 'command' && typeof hook.command === 'string') {
        found.push({ event: SESSION_START, command: hook.command })
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
 * Finds what Claude Code runs without a question when a session starts in a folder (decision 0007):
 * the `SessionStart` hooks of `.claude/settings.json` and the servers of `.mcp.json`. It reads two
 * files and runs nothing. A file that exists but does not parse is reported, never ignored: Claude
 * can still read what Aether cannot.
 */
export class ClaudeProjectScanner implements ProjectScanner {
  async scan(folder: string): Promise<ProjectFindings> {
    const findings: ProjectFindings = { hooks: [], mcpServers: [], unreadable: [] }
    const settings = await readObject(join(folder, SETTINGS))
    if (settings.state === 'ok') findings.hooks.push(...hooksOf(settings.value))
    else if (settings.state === 'unreadable') findings.unreadable.push(SETTINGS)
    const servers = await readObject(join(folder, SERVERS))
    if (servers.state === 'ok') findings.mcpServers.push(...serversOf(servers.value))
    else if (servers.state === 'unreadable') findings.unreadable.push(SERVERS)
    return findings
  }
}
