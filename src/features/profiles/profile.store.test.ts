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
