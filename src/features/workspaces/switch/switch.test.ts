import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { WorkspaceStore } from '../workspace.store'
import { switchWorkspace } from './switch.contract'
import { switchWorkspaceController } from './switch.controller'

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
  return { change: switchWorkspaceController(database), store }
}

describe('workspaces.switch', () => {
  it('saves the current workspace', async () => {
    const { change, store } = setup()
    expect(store.currentId()).toBe('w1')
    const result = await change({ id: 'w2' })
    expect(result).toEqual({ ok: true, value: {} })
    expect(switchWorkspace.output.safeParse(result).success).toBe(true)
    expect(store.currentId()).toBe('w2')
    await change({ id: 'w1' })
    expect(store.currentId()).toBe('w1')
  })

  it('refuses a workspace that does not exist, and keeps the current one', async () => {
    const { change, store } = setup()
    await change({ id: 'w2' })
    expect(await change({ id: 'missing' })).toMatchObject({ ok: false, error: { code: 'unknown-workspace' } })
    expect(store.currentId()).toBe('w2')
  })
})
