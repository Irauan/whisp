import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { WorkspaceStore } from '../workspace.store'
import { removeWorkspace } from './remove.contract'
import { removeWorkspaceController } from './remove.controller'

function setup() {
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  const { database } = opened.value
  const store = new WorkspaceStore(database)
  for (const id of ['w1', 'w2']) {
    store.insert({
      id,
      name: id,
      root: null,
      github: null,
      claudeFolder: null,
      claudeProfile: null,
      createdAt: '2026-01-01T00:00:00.000Z'
    })
  }
  database
    .prepare(
      "INSERT INTO sessions (id, workspace_id, title, prompt, mode, folder, model, created_at) VALUES ('s1', 'w1', 't', 'p', 'ask', 'f', 'default', '2026-01-01')"
    )
    .run()
  return { remove: removeWorkspaceController(database), store, database }
}

describe('workspaces.remove', () => {
  it('removes the workspace and its sessions', async () => {
    const { remove, store, database } = setup()
    const result = await remove({ id: 'w1' })
    expect(result).toEqual({ ok: true, value: {} })
    expect(removeWorkspace.output.safeParse(result).success).toBe(true)
    expect(store.list().map((workspace) => workspace.id)).toEqual(['w2'])
    expect(database.prepare('SELECT count(*) AS total FROM sessions').get()).toMatchObject({ total: 0 })
  })

  it('moves the current workspace to the first one that is left', async () => {
    const { remove, store } = setup()
    store.setCurrent('w1')
    await remove({ id: 'w1' })
    expect(store.currentId()).toBe('w2')
  })

  it('keeps the current workspace when another one is removed', async () => {
    const { remove, store } = setup()
    store.setCurrent('w2')
    await remove({ id: 'w1' })
    expect(store.currentId()).toBe('w2')
  })

  it('allows removing the last workspace, and then no workspace is current', async () => {
    const { remove, store } = setup()
    await remove({ id: 'w1' })
    await remove({ id: 'w2' })
    expect(store.list()).toEqual([])
    expect(store.currentId()).toBeNull()
  })

  it('refuses a workspace that does not exist', async () => {
    const { remove } = setup()
    expect(await remove({ id: 'missing' })).toMatchObject({ ok: false, error: { code: 'unknown-workspace' } })
  })
})
