import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentRegistry } from './registry'

let folder: string
let file: string

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'aether-registry-'))
  file = join(folder, 'agents.json')
})

afterEach(async () => {
  await rm(folder, { recursive: true, force: true })
})

const write = (agents: unknown) => writeFile(file, JSON.stringify({ agents }))

describe('AgentRegistry', () => {
  it('lists nothing when agents.json does not exist, or cannot be read', async () => {
    expect(await new AgentRegistry(file).list()).toEqual([])
    await writeFile(file, '{ not json')
    expect(await new AgentRegistry(file).list()).toEqual([])
  })

  it('gives the program and the arguments of an entry `claude-code` as the replacement of the Claude launch recipe', async () => {
    await write([{ id: 'claude-code', name: 'Claude Code', command: process.execPath, args: ['agent.mjs', 'pipe'] }])
    expect(await new AgentRegistry(file).claudeCodeOverride()).toEqual({
      ok: true,
      value: { command: process.execPath, args: ['agent.mjs', 'pipe'] }
    })
  })

  it('gives no replacement without an entry `claude-code`, and no file gives none', async () => {
    expect(await new AgentRegistry(file).claudeCodeOverride()).toEqual({ ok: true, value: null })
    await write([{ id: 'gemini', name: 'Gemini CLI', command: process.execPath, args: ['--acp'] }])
    expect(await new AgentRegistry(file).claudeCodeOverride()).toEqual({ ok: true, value: null })
  })

  it('gives an error that names the entry when its program does not exist, and never a silent fall back', async () => {
    const missing = join(folder, 'does-not-exist.exe')
    await write([{ id: 'claude-code', name: 'Claude Code', command: missing }])
    const result = await new AgentRegistry(file).claudeCodeOverride()
    expect(result).toMatchObject({ ok: false, error: { code: 'override-unavailable' } })
    expect(!result.ok && result.error.message).toContain('"claude-code" in agents.json')
    expect(!result.ok && result.error.message).toContain(missing)
  })

  it('ignores the environment of an entry: the replacement holds the program and the arguments only', async () => {
    await write([{ id: 'claude-code', name: 'Claude Code', command: process.execPath, env: { ANTHROPIC_API_KEY: 'x' } }])
    expect(await new AgentRegistry(file).claudeCodeOverride()).toEqual({ ok: true, value: { command: process.execPath, args: [] } })
  })

  it('skips an invalid entry, and keeps the first entry of an id', async () => {
    await write([
      { id: 'bad id!', name: 'Bad', command: process.execPath },
      { id: 'one', name: 'First', command: process.execPath },
      { id: 'one', name: 'Second', command: process.execPath },
      { id: 'two', command: process.execPath },
      'text',
      null
    ])
    const agents = await new AgentRegistry(file).list()
    expect(agents.map((agent) => [agent.id, agent.name, agent.available])).toEqual([['one', 'First', true]])
  })

  it('marks an entry whose program is missing as not available', async () => {
    await write([{ id: 'gone', name: 'Gone', command: join(folder, 'does-not-exist.exe') }])
    const [agent] = await new AgentRegistry(file).list()
    expect(agent).toMatchObject({ id: 'gone', available: false })
    expect(agent?.detail).toMatch(/^Cannot find /)
  })
})
