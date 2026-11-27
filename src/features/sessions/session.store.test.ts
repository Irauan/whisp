import { describe, expect, it } from 'vitest'
import { openDatabase, type Database } from '../../building-blocks/database'
import { MIGRATIONS } from '../../building-blocks/migrations'
import { SessionStore } from './session.store'

function setup(): { database: Database; store: SessionStore } {
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  const { database } = opened.value
  database.prepare("INSERT INTO profiles (id, name, github_login, created_at) VALUES ('p1', 'Personal', 'example-user', '2026-01-01')").run()
  database.prepare("INSERT INTO profiles (id, name, created_at) VALUES ('p2', 'Client', '2026-01-01')").run()
  const insert = database.prepare(
    "INSERT INTO sessions (id, profile_id, title, prompt, mode, source_path, model, created_at) VALUES (?, ?, 't', 'p', 'ask', 'C:\\work', 'default', '2026-01-01')"
  )
  insert.run('s1', 'p1')
  insert.run('s2', 'p1')
  insert.run('s3', 'p2')
  return { database, store: new SessionStore(database) }
}

describe('SessionStore: the agent of a session', () => {
  it('starts without a provider, a snapshot and an agent session', () => {
    const { store } = setup()
    expect(store.agentOf('s1')).toEqual({ providerId: null, providerSnapshot: null, agentSessionId: null })
    expect(store.agentOf('missing')).toBeNull()
  })

  it('creates the provider row of a profile once, and gives the same row to the next call', () => {
    const { database, store } = setup()
    const first = store.ensureProvider('p1', 'claude-code', 'v1', '2026-01-02')
    const second = store.ensureProvider('p1', 'claude-code', 'v2', '2026-01-03')
    expect(first).toEqual({ id: 'v1', settings: {} })
    expect(second).toEqual({ id: 'v1', settings: {} })
    expect(database.prepare('SELECT count(*) AS total FROM providers').get()).toMatchObject({ total: 1 })
  })

  it('keeps the settings of a provider row that exists', () => {
    const { database, store } = setup()
    database
      .prepare("INSERT INTO providers (id, profile_id, kind, settings, created_at) VALUES ('v1', 'p1', 'claude-code', '{\"configFolder\":\"C:\\\\claude\"}', '2026-01-01')")
      .run()
    expect(store.ensureProvider('p1', 'claude-code', 'v2', '2026-01-03')).toEqual({ id: 'v1', settings: { configFolder: 'C:\\claude' } })
  })

  it('saves the provider, the snapshot and the agent session of the first start together', () => {
    const { store } = setup()
    store.ensureProvider('p1', 'claude-code', 'v1', '2026-01-02')
    store.saveFirstStart('s1', { providerId: 'v1', snapshot: { configFolder: 'C:\\claude' }, agentSessionId: 'a1' })
    expect(store.agentOf('s1')).toEqual({ providerId: 'v1', providerSnapshot: { configFolder: 'C:\\claude' }, agentSessionId: 'a1' })
    expect(store.agentOf('s2')?.providerSnapshot).toBeNull()
    store.saveAgentSession('s1', 'a2')
    expect(store.agentOf('s1')).toMatchObject({ providerSnapshot: { configFolder: 'C:\\claude' }, agentSessionId: 'a2' })
  })

  it('reads the GitHub login of the profile, and the sessions of a profile', () => {
    const { store } = setup()
    expect(store.githubLoginOf('p1')).toBe('example-user')
    expect(store.githubLoginOf('p2')).toBeNull()
    expect(store.idsByProfile('p1').sort()).toEqual(['s1', 's2'])
  })

  it('saves the mode of a session', () => {
    const { store } = setup()
    expect(store.setMode('s1', 'plan')).toBe(true)
    expect(store.find('s1')?.mode).toBe('plan')
    expect(store.setMode('missing', 'plan')).toBe(false)
  })
})

describe('SessionStore: the entries of a session', () => {
  it('saves entries as validated JSON and reads them in order', () => {
    const { database, store } = setup()
    store.insertEntry('s1', { id: 'e2', entry: { kind: 'agent', text: 'Hello from the agent.' } }, 1, '2026-01-02')
    store.insertEntry('s1', { id: 'e1', entry: { kind: 'user', text: 'Say hello' } }, 0, '2026-01-02')
    expect(store.entriesOf('s1')).toEqual([
      { id: 'e1', entry: { kind: 'user', text: 'Say hello' } },
      { id: 'e2', entry: { kind: 'agent', text: 'Hello from the agent.' } }
    ])
    expect(store.entriesOf('s2')).toEqual([])
    expect(store.entryCount('s1')).toBe(2)
    expect(database.prepare('SELECT kind, data FROM entries WHERE id = ?').get('e1')).toEqual({
      kind: 'user',
      data: '{"kind":"user","text":"Say hello"}'
    })
  })

  it('refuses an entry that breaks the schema, and a row that breaks it', () => {
    const { database, store } = setup()
    expect(() => store.insertEntry('s1', { id: 'e1', entry: { kind: 'user' } as never }, 0, '2026-01-02')).toThrow()
    database
      .prepare(`INSERT INTO entries (id, session_id, position, kind, data, created_at) VALUES ('bad', 's1', 0, 'user', '{"kind":"user"}', '2026-01-02')`)
      .run()
    expect(() => store.entriesOf('s1')).toThrow()
  })

  it('gives the next position of a session', () => {
    const { store } = setup()
    expect(store.nextPosition('s1')).toBe(0)
    store.insertEntry('s1', { id: 'e1', entry: { kind: 'user', text: 'a' } }, 0, '2026-01-02')
    store.insertEntry('s1', { id: 'e2', entry: { kind: 'agent', text: 'b' } }, 1, '2026-01-02')
    expect(store.nextPosition('s1')).toBe(2)
    expect(store.nextPosition('s2')).toBe(0)
  })

  it('finds a tool entry by its call ID, and lists the open ones', () => {
    const { store } = setup()
    const tool = (id: string, toolId: string, status: 'pending' | 'in_progress' | 'completed' | 'failed') =>
      ({ id, entry: { kind: 'tool', toolId, title: 'Run it', toolKind: 'execute', status } }) as const
    store.insertEntry('s1', tool('e1', 'a', 'completed'), 0, '2026-01-02')
    store.insertEntry('s1', tool('e2', 'b', 'in_progress'), 1, '2026-01-02')
    store.insertEntry('s1', tool('e3', 'c', 'pending'), 2, '2026-01-02')
    expect(store.findTool('s1', 'b')?.id).toBe('e2')
    expect(store.findTool('s1', 'missing')).toBeNull()
    expect(store.findTool('s2', 'b')).toBeNull()
    expect(store.openTools('s1').map((view) => view.id)).toEqual(['e2', 'e3'])
  })

  it('finds a tool call only in the turn that runs: an agent can reuse a call ID in the next turn', () => {
    const { store } = setup()
    const tool = (id: string, status: 'completed' | 'in_progress') =>
      ({ id, entry: { kind: 'tool', toolId: 't1', title: 'Edit README.md', toolKind: 'edit', status } }) as const
    store.insertEntry('s1', { id: 'u1', entry: { kind: 'user', text: 'first' } }, 0, '2026-01-02')
    store.insertEntry('s1', tool('e1', 'completed'), 1, '2026-01-02')
    expect(store.findTool('s1', 't1')?.id).toBe('e1')
    store.insertEntry('s1', { id: 'u2', entry: { kind: 'user', text: 'second' } }, 2, '2026-01-02')
    expect(store.findTool('s1', 't1')).toBeNull()
    store.insertEntry('s1', tool('e2', 'in_progress'), 3, '2026-01-02')
    expect(store.findTool('s1', 't1')?.id).toBe('e2')
  })

  it('replaces the JSON of an entry', () => {
    const { store } = setup()
    store.insertEntry('s1', { id: 'e1', entry: { kind: 'tool', toolId: 'a', title: 'Run it', toolKind: 'execute', status: 'in_progress' } }, 0, '2026-01-02')
    expect(store.updateEntry({ id: 'e1', entry: { kind: 'tool', toolId: 'a', title: 'Run it', toolKind: 'execute', status: 'failed' } })).toBe(true)
    expect(store.entriesOf('s1')[0]?.entry).toMatchObject({ status: 'failed' })
    expect(store.updateEntry({ id: 'missing', entry: { kind: 'agent', text: 'x' } })).toBe(false)
  })

  it('removes the entries with the session', () => {
    const { store } = setup()
    store.insertEntry('s1', { id: 'e1', entry: { kind: 'user', text: 'a' } }, 0, '2026-01-02')
    store.remove('s1')
    expect(store.entryCount('s1')).toBe(0)
  })
})
