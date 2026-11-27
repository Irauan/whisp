import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { ProfileStore } from '../profile.store'
import { removeProfile } from './remove.contract'
import { removeProfileController } from './remove.controller'

function setup() {
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  const { database } = opened.value
  const store = new ProfileStore(database)
  for (const id of ['w1', 'w2']) {
    store.insert({
      id,
      name: id,
      workspaceDirectory: null,
      github: null,
      claudeFolder: null,
      claudeProfileName: null,
      createdAt: '2026-01-01T00:00:00.000Z'
    })
  }
  database
    .prepare(
      "INSERT INTO sessions (id, profile_id, title, prompt, mode, source_path, model, created_at) VALUES ('s1', 'w1', 't', 'p', 'ask', 'f', 'default', '2026-01-01')"
    )
    .run()
  return { remove: removeProfileController(database), store, database }
}

describe('profiles.remove', () => {
  it('removes the profile and its sessions', async () => {
    const { remove, store, database } = setup()
    const result = await remove({ id: 'w1' })
    expect(result).toEqual({ ok: true, value: {} })
    expect(removeProfile.output.safeParse(result).success).toBe(true)
    expect(store.list().map((profile) => profile.id)).toEqual(['w2'])
    expect(database.prepare('SELECT count(*) AS total FROM sessions').get()).toMatchObject({ total: 0 })
  })

  it('moves the current profile to the first one that is left', async () => {
    const { remove, store } = setup()
    store.setCurrent('w1')
    await remove({ id: 'w1' })
    expect(store.currentId()).toBe('w2')
  })

  it('keeps the current profile when another one is removed', async () => {
    const { remove, store } = setup()
    store.setCurrent('w2')
    await remove({ id: 'w1' })
    expect(store.currentId()).toBe('w2')
  })

  it('allows removing the last profile, and then no profile is current', async () => {
    const { remove, store } = setup()
    await remove({ id: 'w1' })
    await remove({ id: 'w2' })
    expect(store.list()).toEqual([])
    expect(store.currentId()).toBeNull()
  })

  it('refuses a profile that does not exist', async () => {
    const { remove } = setup()
    expect(await remove({ id: 'missing' })).toMatchObject({ ok: false, error: { code: 'unknown-profile' } })
  })
})
