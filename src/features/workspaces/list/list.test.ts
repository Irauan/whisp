import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import type { Notice, Workspace } from '../workspace'
import { WorkspaceStore } from '../workspace.store'
import { listWorkspaces } from './list.contract'
import { listWorkspacesController } from './list.controller'

function setup() {
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  const { database } = opened.value
  return { database, store: new WorkspaceStore(database) }
}

const workspace = (id: string, name: string, createdAt: string): Workspace => ({
  id,
  name,
  root: null,
  github: null,
  claudeFolder: null,
  claudeProfile: null,
  createdAt
})

describe('workspaces.list', () => {
  it('lists no workspace and no current workspace on an empty database', async () => {
    const { database } = setup()
    const result = await listWorkspacesController(database, () => [])()
    expect(result).toEqual({ ok: true, value: { workspaces: [], currentId: null, notices: [] } })
    expect(listWorkspaces.output.safeParse(result).success).toBe(true)
  })

  it('lists the workspaces in the order that they were added, and the first is current', async () => {
    const { database, store } = setup()
    store.insert(workspace('b', 'Second', '2026-01-02'))
    store.insert(workspace('a', 'First', '2026-01-01'))
    const result = await listWorkspacesController(database, () => [])()
    expect(result).toMatchObject({ ok: true, value: { currentId: 'a' } })
    if (!result.ok) return
    expect(result.value.workspaces.map((item) => item.name)).toEqual(['First', 'Second'])
    expect(listWorkspaces.output.safeParse(result).success).toBe(true)
  })

  it('shows the saved current workspace, the saved GitHub account and the Claude sign-in', async () => {
    const { database, store } = setup()
    store.insert({
      ...workspace('a', 'First', '2026-01-01'),
      root: 'C:\\roots\\first',
      github: { login: 'example-user', name: 'Example User', avatar: null },
      claudeFolder: 'C:\\claude\\first',
      claudeProfile: 'work'
    })
    store.insert(workspace('b', 'Second', '2026-01-02'))
    store.setCurrent('b')
    const result = await listWorkspacesController(database, () => [])()
    expect(result).toMatchObject({
      ok: true,
      value: {
        currentId: 'b',
        workspaces: [
          {
            id: 'a',
            root: 'C:\\roots\\first',
            github: { login: 'example-user', name: 'Example User', avatar: null },
            claudeFolder: 'C:\\claude\\first',
            claudeProfile: 'work'
          },
          { id: 'b', root: null, github: null }
        ]
      }
    })
  })

  it('returns the messages of the start', async () => {
    const { database } = setup()
    const notices: Notice[] = [{ code: 'workspace-file-unreadable', message: 'Aether could not read workspace.json.' }]
    const result = await listWorkspacesController(database, () => notices)()
    expect(result).toMatchObject({ ok: true, value: { notices } })
    expect(listWorkspaces.output.safeParse(result).success).toBe(true)
  })
})
