import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClaudeProjectScanner } from './project-scanner'

let folder: string

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'aether-scanner-'))
})

afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
})

const write = (name: string, text: string) => {
  const path = join(folder, name)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

const scan = () => new ClaudeProjectScanner().scan(folder)

describe('ClaudeProjectScanner', () => {
  it('finds nothing in a plain folder', async () => {
    expect(await scan()).toEqual({ hooks: [], mcpServers: [], unreadable: [] })
  })

  it('finds each command hook of SessionStart with its event', async () => {
    write(
      '.claude/settings.json',
      JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: 'node a.js' }, { type: 'command', command: 'node b.js' }] }, { hooks: [{ type: 'command', command: 'node c.js' }] }],
          PreToolUse: [{ hooks: [{ type: 'command', command: 'node other.js' }] }]
        }
      })
    )
    expect((await scan()).hooks).toEqual([
      { event: 'SessionStart', command: 'node a.js' },
      { event: 'SessionStart', command: 'node b.js' },
      { event: 'SessionStart', command: 'node c.js' }
    ])
  })

  it('ignores a hook that is not a command, and a settings file without hooks', async () => {
    write('.claude/settings.json', JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'prompt', prompt: 'x' }, { type: 'command' }, 7] }, null, 'text'] } }))
    expect(await scan()).toEqual({ hooks: [], mcpServers: [], unreadable: [] })
    write('.claude/settings.json', JSON.stringify({ model: 'x' }))
    expect(await scan()).toEqual({ hooks: [], mcpServers: [], unreadable: [] })
  })

  it('finds each server of .mcp.json with its command line', async () => {
    write('.mcp.json', JSON.stringify({ mcpServers: { 'example-tools': { command: 'node', args: ['tools/server.js', 3] }, remote: { url: 'https://example.invalid' } } }))
    expect((await scan()).mcpServers).toEqual([
      { name: 'example-tools', command: 'node tools/server.js 3' },
      { name: 'remote', command: null }
    ])
  })

  it('reports a file that exists but does not parse, and one that is not an object', async () => {
    write('.claude/settings.json', '{ not json')
    write('.mcp.json', '[]')
    expect((await scan()).unreadable).toEqual([join('.claude', 'settings.json'), '.mcp.json'])
  })

  it('reports a path that is a folder and not a file as unreadable', async () => {
    mkdirSync(join(folder, '.mcp.json'))
    expect((await scan()).unreadable).toEqual(['.mcp.json'])
  })

  it('accepts a file with a byte order mark', async () => {
    write('.mcp.json', `﻿${JSON.stringify({ mcpServers: { a: { command: 'node' } } })}`)
    expect((await scan()).mcpServers).toEqual([{ name: 'a', command: 'node' }])
  })
})
