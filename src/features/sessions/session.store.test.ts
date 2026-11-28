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

const insertProvider = (database: Database, id: string, profile: string, settings: string, current: number, at = '2026-01-01') =>
  database
    .prepare("INSERT INTO providers (id, profile_id, kind, label, settings, is_current, created_at) VALUES (?, ?, 'claude-code', 'Claude', ?, ?, ?)")
    .run(id, profile, settings, current, at)

describe('SessionStore: the agent runs of a session', () => {
  it('starts without an agent run', () => {
    const { store } = setup()
    expect(store.agentRunOf('s1')).toBeNull()
  })

  it('finds the current account of a profile, and no account when the profile has none', () => {
    const { database, store } = setup()
    expect(store.currentProvider('p1', 'claude-code')).toBeNull()
    insertProvider(database, 'old', 'p1', '{"configFolder":"C:/f1"}', 0)
    insertProvider(database, 'new', 'p1', '{"configFolder":"C:/f2"}', 1)
    expect(store.currentProvider('p1', 'claude-code')).toEqual({ id: 'new', settings: { configFolder: 'C:/f2' } })
  })

  it('creates the current account of a profile once, and gives the same account to the next call', () => {
    const { database, store } = setup()
    const first = store.ensureCurrentProvider('p1', 'claude-code', 'v1', '2026-01-02')
    const second = store.ensureCurrentProvider('p1', 'claude-code', 'v2', '2026-01-03')
    expect(first).toEqual({ id: 'v1', settings: {} })
    expect(second).toEqual({ id: 'v1', settings: {} })
    expect(database.prepare('SELECT count(*) AS total FROM providers').get()).toMatchObject({ total: 1 })
  })

  it('keeps the settings of the current account that exists', () => {
    const { database, store } = setup()
    insertProvider(database, 'v1', 'p1', '{"configFolder":"C:/claude"}', 1)
    expect(store.ensureCurrentProvider('p1', 'claude-code', 'v2', '2026-01-03')).toEqual({ id: 'v1', settings: { configFolder: 'C:/claude' } })
  })

  it('saves the first run with its account, and sets the account of the session', () => {
    const { database, store } = setup()
    insertProvider(database, 'v1', 'p1', '{"configFolder":"C:/claude"}', 1)
    store.saveFirstRun('s1', { id: 'r1', providerId: 'v1', externalId: 'a1', createdAt: '2026-01-02' })
    expect(store.agentRunOf('s1')).toEqual({ id: 'r1', providerId: 'v1', settings: { configFolder: 'C:/claude' }, externalId: 'a1' })
    expect(store.find('s1')?.providerId).toBe('v1')
    expect(store.agentRunOf('s2')).toBeNull()
    // The account of the run is the account of the session.
    insertProvider(database, 'v2', 'p1', '{}', 0)
    database.prepare("UPDATE sessions SET provider_id = 'v2' WHERE id = 's2'").run()
    store.saveFirstRun('s2', { id: 'r2', providerId: 'v1', externalId: 'a2', createdAt: '2026-01-02' })
    expect(store.find('s2')?.providerId).toBe('v1')
  })

  it('reads the newest run, and saves a new agent session in the run', () => {
    const { database, store } = setup()
    insertProvider(database, 'v1', 'p1', '{}', 1)
    store.saveFirstRun('s1', { id: 'r1', providerId: 'v1', externalId: 'a1', createdAt: '2026-01-02' })
    store.saveExternalId('r1', 'a2')
    expect(store.agentRunOf('s1')).toMatchObject({ id: 'r1', externalId: 'a2' })
    expect(database.prepare('SELECT count(*) AS total FROM agent_sessions').get()).toMatchObject({ total: 1 })
  })

  it('refuses a change of the Claude folder of an account that a run used, and lets the label and the other settings change', () => {
    const { database, store } = setup()
    insertProvider(database, 'v1', 'p1', '{"configFolder":"C:/f1"}', 1)
    store.saveFirstRun('s1', { id: 'r1', providerId: 'v1', externalId: 'a1', createdAt: '2026-01-02' })
    expect(() => database.prepare(`UPDATE providers SET settings = '{"configFolder":"C:/f2"}' WHERE id = 'v1'`).run()).toThrow(/cannot change/)
    expect(() => database.prepare(`UPDATE providers SET settings = '{}' WHERE id = 'v1'`).run()).toThrow(/cannot change/)
    database.prepare(`UPDATE providers SET settings = '{"configFolder":"C:/f1","profileName":"work"}' WHERE id = 'v1'`).run()
    database.prepare(`UPDATE providers SET label = 'Work' WHERE id = 'v1'`).run()
    expect(database.prepare("SELECT settings FROM providers WHERE id = 'v1'").get()).toEqual({ settings: '{"configFolder":"C:/f1","profileName":"work"}' })
    // An account that no run used can change its folder.
    insertProvider(database, 'v2', 'p1', '{"configFolder":"C:/f1"}', 0)
    database.prepare(`UPDATE providers SET settings = '{"configFolder":"C:/f2"}' WHERE id = 'v2'`).run()
  })

  it('keeps one current account for each profile and kind', () => {
    const { database } = setup()
    insertProvider(database, 'v1', 'p1', '{}', 1)
    expect(() => insertProvider(database, 'v2', 'p1', '{"configFolder":"C:/f2"}', 1)).toThrow()
    insertProvider(database, 'v2', 'p1', '{"configFolder":"C:/f2"}', 0)
    insertProvider(database, 'v3', 'p2', '{}', 1)
  })

  it('stops the delete of an account that a run used, but a removed profile removes its sessions, runs and accounts', () => {
    const { database, store } = setup()
    insertProvider(database, 'v1', 'p1', '{}', 1)
    store.saveFirstRun('s1', { id: 'r1', providerId: 'v1', externalId: 'a1', createdAt: '2026-01-02' })
    expect(() => database.prepare("DELETE FROM providers WHERE id = 'v1'").run()).toThrow()
    database.prepare("DELETE FROM profiles WHERE id = 'p1'").run()
    expect(database.prepare('SELECT count(*) AS total FROM agent_sessions').get()).toMatchObject({ total: 0 })
    expect(database.prepare('SELECT count(*) AS total FROM providers').get()).toMatchObject({ total: 0 })
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

  it('saves the model of a session', () => {
    const { store } = setup()
    expect(store.setModel('s1', 'claude-opus-5-5')).toBe(true)
    expect(store.find('s1')?.model).toBe('claude-opus-5-5')
    expect(store.setModel('missing', 'claude-opus-5-5')).toBe(false)
  })

  it('saves the title with its source, starts with the source prompt, and refuses an unknown session and a bad source', () => {
    const { store } = setup()
    expect(store.titleSourceOf('s1')).toBe('prompt')
    expect(store.titleSourceOf('missing')).toBeNull()
    expect(store.setTitle('s1', 'Greeting test', 'agent')).toBe(true)
    expect(store.find('s1')?.title).toBe('Greeting test')
    expect(store.titleSourceOf('s1')).toBe('agent')
    expect(store.setTitle('s1', 'My name', 'user')).toBe(true)
    expect(store.titleSourceOf('s1')).toBe('user')
    expect(store.setTitle('missing', 'Any', 'agent')).toBe(false)
    expect(() => store.setTitle('s1', 'Other', 'robot' as never)).toThrow()
    expect(() => store.setTitle('s1', 'Other', 'prompt' as never)).toThrow()
    expect(store.find('s1')?.title).toBe('My name')
  })

  it('never lets a title of the agent replace a title of the user, and lets a later rename replace it', () => {
    const { store } = setup()
    expect(store.setTitle('s1', 'My name', 'user')).toBe(true)
    expect(store.setTitle('s1', 'Agent name', 'agent')).toBe(false)
    expect(store.find('s1')?.title).toBe('My name')
    expect(store.titleSourceOf('s1')).toBe('user')
    expect(store.setTitle('s1', 'Newer name', 'user')).toBe(true)
    expect(store.find('s1')?.title).toBe('Newer name')
  })

  it('reads a row with an unknown title source as a defect', () => {
    const { database, store } = setup()
    database.prepare("UPDATE sessions SET title_source = 'robot' WHERE id = 's1'").run()
    expect(() => store.titleSourceOf('s1')).toThrow()
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

describe('SessionStore: the latest plan entry', () => {
  it('returns the latest plan entry of the session, and null when it has none', () => {
    const { store } = setup()
    expect(store.latestPlan('s1')).toBeNull()
    store.insertEntry('s1', { id: 'a', entry: { kind: 'plan', steps: [{ text: 'One', status: 'pending' }] } }, 0, '2026-01-02')
    store.insertEntry('s1', { id: 'b', entry: { kind: 'user', text: 'x' } }, 1, '2026-01-02')
    store.insertEntry('s1', { id: 'c', entry: { kind: 'plan', steps: [] } }, 2, '2026-01-02')
    store.insertEntry('s1', { id: 'd', entry: { kind: 'agent', text: 'y' } }, 3, '2026-01-02')
    expect(store.latestPlan('s1')).toEqual({ id: 'c', entry: { kind: 'plan', steps: [] } })
    expect(store.latestPlan('s2')).toBeNull()
  })
})

describe('SessionStore: who started a session', () => {
  it('gives person for a session that the row left at the default, and for a new session by default', () => {
    const { store } = setup()
    expect(store.startedByOf('s1')).toBe('person')
    const session = store.find('s1')!
    store.insert({ ...session, id: 's4' })
    expect(store.startedByOf('s4')).toBe('person')
  })

  it('saves automation when the caller says so, and gives null for an unknown session', () => {
    const { store } = setup()
    store.insert({ ...store.find('s1')!, id: 's5' }, 'automation')
    expect(store.startedByOf('s5')).toBe('automation')
    expect(store.startedByOf('missing')).toBeNull()
  })

  it('refuses a value that is not a starter, on write and on read', () => {
    const { database, store } = setup()
    expect(() => store.insert({ ...store.find('s1')!, id: 's6' }, 'robot' as never)).toThrow()
    database.prepare("UPDATE sessions SET started_by = 'robot' WHERE id = 's1'").run()
    expect(() => store.startedByOf('s1')).toThrow()
  })
})

describe('SessionStore: the cards that were open at a stop', () => {
  const answers = (outcome: string) => ({ kind: 'answers', card: 'decision', toolId: 't', outcome, rows: [{ question: 'Run this command?', answer: null }] })

  it('changes each open card to interrupted, and leaves every other entry as it was', () => {
    const { store } = setup()
    store.insertEntry('s1', { id: 'a', entry: answers('open') as never }, 0, '2026-01-01')
    store.insertEntry('s1', { id: 'b', entry: answers('submitted') as never }, 1, '2026-01-01')
    store.insertEntry('s1', { id: 'c', entry: { kind: 'user', text: 'x' } }, 2, '2026-01-01')
    store.insertEntry('s2', { id: 'd', entry: answers('open') as never }, 0, '2026-01-01')
    expect(store.interruptOpenCards()).toBe(2)
    expect(store.entriesOf('s1').map((view) => view.entry)).toEqual([answers('interrupted'), answers('submitted'), { kind: 'user', text: 'x' }])
    expect(store.entriesOf('s2').map((view) => view.entry)).toEqual([answers('interrupted')])
    expect(store.interruptOpenCards()).toBe(0)
  })
})
