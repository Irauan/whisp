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
    expect(await scan()).toEqual({ hooks: [], mcpServers: [], files: [], unreadable: [] })
  })

  it('finds each command hook of every event, not only SessionStart (F1)', async () => {
    write(
      '.claude/settings.json',
      JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: 'node a.js' }, { type: 'command', command: 'node b.js' }] }, { hooks: [{ type: 'command', command: 'node c.js' }] }],
          PreToolUse: [{ hooks: [{ type: 'command', command: 'node other.js' }] }],
          UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node prompt.js' }] }]
        }
      })
    )
    expect((await scan()).hooks).toEqual([
      { event: 'SessionStart', command: 'node a.js' },
      { event: 'SessionStart', command: 'node b.js' },
      { event: 'SessionStart', command: 'node c.js' },
      { event: 'PreToolUse', command: 'node other.js' },
      { event: 'UserPromptSubmit', command: 'node prompt.js' }
    ])
  })

  it('reads settings.local.json and any other settings*.json file (F1)', async () => {
    write('.claude/settings.local.json', JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node local.js' }] }] } }))
    write('.claude/settings.team.json', '{}')
    write('.claude/other.json', JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node no.js' }] }] } }))
    const found = await scan()
    expect(found.hooks).toEqual([{ event: 'SessionStart', command: 'node local.js' }])
    expect(found.files.map((file) => file.name)).toEqual([join('.claude', 'settings.local.json'), join('.claude', 'settings.team.json')])
  })

  it('lists a file that holds no hook, with the names of its other keys (F1)', async () => {
    write('.claude/settings.json', JSON.stringify({ apiKeyHelper: 'node helper.js', env: { A: '1' }, hooks: {} }))
    expect(await scan()).toEqual({
      hooks: [],
      mcpServers: [],
      files: [{ name: join('.claude', 'settings.json'), keys: ['apiKeyHelper', 'env'] }],
      unreadable: []
    })
  })

  it('lists an empty settings file and an empty .mcp.json: any such file asks (F2)', async () => {
    write('.claude/settings.json', '{}')
    write('.mcp.json', '{}')
    expect((await scan()).files).toEqual([
      { name: join('.claude', 'settings.json'), keys: [] },
      { name: '.mcp.json', keys: [] }
    ])
  })

  it('ignores a hook that is not a command, and a settings file without hooks', async () => {
    write('.claude/settings.json', JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'prompt', prompt: 'x' }, { type: 'command' }, 7] }, null, 'text'] } }))
    expect((await scan()).hooks).toEqual([])
  })

  it('finds each server of .mcp.json with its command line, and the other keys', async () => {
    write('.mcp.json', JSON.stringify({ extra: true, mcpServers: { 'example-tools': { command: 'node', args: ['tools/server.js', 3] }, remote: { url: 'https://example.invalid' } } }))
    const found = await scan()
    expect(found.mcpServers).toEqual([
      { name: 'example-tools', command: 'node tools/server.js 3' },
      { name: 'remote', command: null }
    ])
    expect(found.files).toEqual([{ name: '.mcp.json', keys: ['extra'] }])
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
    write('.mcp.json', `\uFEFF${JSON.stringify({ mcpServers: { a: { command: 'node' } } })}`)
    expect((await scan()).mcpServers).toEqual([{ name: 'a', command: 'node' }])
  })
})
