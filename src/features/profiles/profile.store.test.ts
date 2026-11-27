import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../building-blocks/database'
import { MIGRATIONS } from '../../building-blocks/migrations'
import { ProfileStore } from './profile.store'

function setup() {
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  const { database } = opened.value
  const store = new ProfileStore(database)
  store.insert({
    id: 'p1',
    name: 'Work',
    workspaceDirectory: null,
    github: null,
    claudeFolder: null,
    claudeProfileName: null,
    createdAt: '2026-01-01T00:00:00.000Z'
  })
  let count = 0
  return { database, store, ids: { next: () => `v${(count += 1)}` } }
}

const rows = (database: ReturnType<typeof setup>['database']) =>
  database.prepare('SELECT id, profile_id, kind, settings FROM providers').all()

describe('ProfileStore.saveProvider', () => {
  it('refuses an unknown kind, and saves no row, because the table has no check for the kind', () => {
    const { database, store, ids } = setup()
    expect(() => store.saveProvider('p1', 'copilot', {}, ids, '2026-01-01')).toThrow(/does not know the provider kind/)
    expect(() => store.saveProvider('p1', 'copilot', { token: 'x' }, ids, '2026-01-01')).toThrow()
    expect(rows(database)).toEqual([])
  })

  it('refuses settings that the schema of the kind does not accept, on the write path', () => {
    const { database, store, ids } = setup()
    for (const bad of [{ apiKey: 'x' }, { configFolder: 5 }, { configFolder: '' }, null, 'text', []]) {
      expect(() => store.saveProvider('p1', 'claude-code', bad, ids, '2026-01-01')).toThrow()
    }
    expect(rows(database)).toEqual([])
  })

  it('edits the one row of the profile in place', () => {
    const { database, store, ids } = setup()
    store.saveClaude('p1', { configFolder: 'C:\\claude', profileName: 'work' }, ids, '2026-01-01')
    store.saveClaude('p1', { configFolder: 'C:\\other', profileName: null }, ids, '2026-01-02')
    expect(rows(database)).toEqual([
      { id: 'v1', profile_id: 'p1', kind: 'claude-code', settings: JSON.stringify({ configFolder: 'C:\\other' }) }
    ])
  })

  it('keeps the row with empty settings when the user clears them, and makes no row without a setting', () => {
    const { database, store, ids } = setup()
    store.saveClaude('p1', { configFolder: null, profileName: null }, ids, '2026-01-01')
    expect(rows(database)).toEqual([])
    store.saveClaude('p1', { configFolder: null, profileName: 'work' }, ids, '2026-01-01')
    store.saveClaude('p1', { configFolder: null, profileName: null }, ids, '2026-01-02')
    expect(rows(database)).toEqual([{ id: 'v1', profile_id: 'p1', kind: 'claude-code', settings: '{}' }])
  })

  it('reads the settings through the same schema, and throws on a row that breaks it', () => {
    const { database, store, ids } = setup()
    store.saveClaude('p1', { configFolder: 'C:\\claude', profileName: 'work' }, ids, '2026-01-01')
    expect(store.find('p1')).toMatchObject({ claudeFolder: 'C:\\claude', claudeProfileName: 'work' })
    database.prepare("UPDATE providers SET settings = '{\"apiKey\":\"x\"}'").run()
    expect(() => store.find('p1')).toThrow()
  })
})

/** Gives the account an agent run, so that the account counts as used. */
function useAccount(database: ReturnType<typeof setup>['database'], providerId: string, runId: string) {
  database
    .prepare("INSERT INTO sessions (id, profile_id, title, prompt, mode, source_path, model, created_at) VALUES (?, 'p1', 't', 'p', 'ask', 'f', 'default', '2026-01-01')")
    .run(`session-${runId}`)
  database
    .prepare("INSERT INTO agent_sessions (id, session_id, provider_id, external_id, created_at) VALUES (?, ?, ?, 'a1', '2026-01-01')")
    .run(runId, `session-${runId}`, providerId)
}

const accounts = (database: ReturnType<typeof setup>['database']) =>
  database.prepare('SELECT id, settings, is_current FROM providers ORDER BY created_at, rowid').all()

describe('ProfileStore.saveProvider: used accounts (decision 0014)', () => {
  it('makes the first account current, with the label Claude', () => {
    const { database, store, ids } = setup()
    store.saveClaude('p1', { configFolder: 'C:/f1', profileName: null }, ids, '2026-01-01')
    expect(database.prepare('SELECT label, is_current FROM providers').all()).toEqual([{ label: 'Claude', is_current: 1 }])
    expect(store.find('p1')).toMatchObject({ claudeFolder: 'C:/f1' })
  })

  it('changes an account that no agent session used in place, and makes no new row', () => {
    const { database, store, ids } = setup()
    store.saveClaude('p1', { configFolder: 'C:/f1', profileName: null }, ids, '2026-01-01')
    store.saveClaude('p1', { configFolder: 'C:/f2', profileName: 'work' }, ids, '2026-01-02')
    expect(accounts(database)).toEqual([{ id: 'v1', settings: '{"configFolder":"C:/f2","profileName":"work"}', is_current: 1 }])
  })

  it('changes nothing when the settings are the same', () => {
    const { database, store, ids } = setup()
    store.saveClaude('p1', { configFolder: 'C:/f1', profileName: 'work' }, ids, '2026-01-01')
    useAccount(database, 'v1', 'r1')
    store.saveClaude('p1', { configFolder: 'C:/f1', profileName: 'work' }, ids, '2026-01-02')
    expect(accounts(database)).toHaveLength(1)
  })

  it('makes a new current account when the account was used, and keeps the old account with its folder for its runs', () => {
    const { database, store, ids } = setup()
    store.saveClaude('p1', { configFolder: 'C:/f1', profileName: null }, ids, '2026-01-01')
    useAccount(database, 'v1', 'r1')
    store.saveClaude('p1', { configFolder: 'C:/f2', profileName: null }, ids, '2026-01-02')
    expect(accounts(database)).toEqual([
      { id: 'v1', settings: '{"configFolder":"C:/f1"}', is_current: 0 },
      { id: 'v2', settings: '{"configFolder":"C:/f2"}', is_current: 1 }
    ])
    expect(store.find('p1')).toMatchObject({ claudeFolder: 'C:/f2' })
    // The new account is not used yet, so the next edit changes it in place.
    store.saveClaude('p1', { configFolder: 'C:/f3', profileName: null }, ids, '2026-01-03')
    expect(accounts(database)).toHaveLength(2)
    expect(accounts(database)[1]).toMatchObject({ id: 'v2', settings: '{"configFolder":"C:/f3"}' })
  })

  it('also makes a new account for a change of the Claude profile name or for cleared settings, because a resume reads the account', () => {
    const { database, store, ids } = setup()
    store.saveClaude('p1', { configFolder: 'C:/f1', profileName: null }, ids, '2026-01-01')
    useAccount(database, 'v1', 'r1')
    store.saveClaude('p1', { configFolder: 'C:/f1', profileName: 'work' }, ids, '2026-01-02')
    expect(accounts(database).map((row) => [row.id, row.is_current])).toEqual([
      ['v1', 0],
      ['v2', 1]
    ])
    useAccount(database, 'v2', 'r2')
    store.saveClaude('p1', { configFolder: null, profileName: null }, ids, '2026-01-03')
    expect(accounts(database).map((row) => [row.id, row.settings, row.is_current])).toEqual([
      ['v1', '{"configFolder":"C:/f1"}', 0],
      ['v2', '{"configFolder":"C:/f1","profileName":"work"}', 0],
      ['v3', '{}', 1]
    ])
  })

  it('makes an account with the same settings current again, and makes no duplicate', () => {
    const { database, store, ids } = setup()
    store.saveClaude('p1', { configFolder: 'C:/f1', profileName: null }, ids, '2026-01-01')
    useAccount(database, 'v1', 'r1')
    store.saveClaude('p1', { configFolder: 'C:/f2', profileName: null }, ids, '2026-01-02')
    useAccount(database, 'v2', 'r2')
    store.saveClaude('p1', { configFolder: 'C:/f1', profileName: null }, ids, '2026-01-03')
    expect(accounts(database).map((row) => [row.id, row.is_current])).toEqual([
      ['v1', 1],
      ['v2', 0]
    ])
  })

  it('shows one profile when the profile has more than one account, with the settings of the current one', () => {
    const { database, store, ids } = setup()
    store.saveClaude('p1', { configFolder: 'C:/f1', profileName: null }, ids, '2026-01-01')
    useAccount(database, 'v1', 'r1')
    store.saveClaude('p1', { configFolder: 'C:/f2', profileName: null }, ids, '2026-01-02')
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0]).toMatchObject({ claudeFolder: 'C:/f2' })
  })

  it('keeps the accounts of other profiles apart', () => {
    const { database, store, ids } = setup()
    store.insert({ id: 'p2', name: 'Client', workspaceDirectory: null, github: null, claudeFolder: null, claudeProfileName: null, createdAt: '2026-01-01T00:00:00.000Z' })
    store.saveClaude('p1', { configFolder: 'C:/f1', profileName: null }, ids, '2026-01-01')
    store.saveClaude('p2', { configFolder: 'C:/f1', profileName: null }, ids, '2026-01-01')
    expect(database.prepare('SELECT profile_id, is_current FROM providers ORDER BY profile_id').all()).toEqual([
      { profile_id: 'p1', is_current: 1 },
      { profile_id: 'p2', is_current: 1 }
    ])
  })
})
