import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import type { Notice, Profile } from '../profile'
import { ProfileStore } from '../profile.store'
import { listProfiles } from './list.contract'
import { listProfilesController } from './list.controller'

function setup() {
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  const { database } = opened.value
  return { database, store: new ProfileStore(database) }
}

const profile = (id: string, name: string, createdAt: string): Profile => ({
  id,
  name,
  workspaceDirectory: null,
  github: null,
  claudeFolder: null,
  createdAt
})

describe('profiles.list', () => {
  it('lists no profile and no current profile on an empty database', async () => {
    const { database } = setup()
    const result = await listProfilesController(database, () => [])()
    expect(result).toEqual({ ok: true, value: { profiles: [], currentId: null, notices: [] } })
    expect(listProfiles.output.safeParse(result).success).toBe(true)
  })

  it('lists the profiles in the order that they were added, and the first is current', async () => {
    const { database, store } = setup()
    store.insert(profile('b', 'Second', '2026-01-02'))
    store.insert(profile('a', 'First', '2026-01-01'))
    const result = await listProfilesController(database, () => [])()
    expect(result).toMatchObject({ ok: true, value: { currentId: 'a' } })
    if (!result.ok) return
    expect(result.value.profiles.map((item) => item.name)).toEqual(['First', 'Second'])
    expect(listProfiles.output.safeParse(result).success).toBe(true)
  })

  it('shows the saved current profile, the saved GitHub account and the Claude sign-in', async () => {
    const { database, store } = setup()
    store.insert({
      ...profile('a', 'First', '2026-01-01'),
      workspaceDirectory: 'C:\\directories\\first',
      github: { login: 'example-user', name: 'Example User', avatar: null }
    })
    store.saveClaude('a', { configFolder: 'C:\\claude\\first' }, { next: () => 'provider-1' }, '2026-01-01')
    store.insert(profile('b', 'Second', '2026-01-02'))
    store.setCurrent('b')
    const result = await listProfilesController(database, () => [])()
    expect(result).toMatchObject({
      ok: true,
      value: {
        currentId: 'b',
        profiles: [
          {
            id: 'a',
            workspaceDirectory: 'C:\\directories\\first',
            github: { login: 'example-user', name: 'Example User', avatar: null },
            claudeFolder: 'C:\\claude\\first'
          },
          { id: 'b', workspaceDirectory: null, github: null }
        ]
      }
    })
  })

  it('returns the messages of the start', async () => {
    const { database } = setup()
    const notices: Notice[] = [{ code: 'workspace-file-unreadable', message: 'Aether could not read workspace.json.' }]
    const result = await listProfilesController(database, () => notices)()
    expect(result).toMatchObject({ ok: true, value: { notices } })
    expect(listProfiles.output.safeParse(result).success).toBe(true)
  })
})
