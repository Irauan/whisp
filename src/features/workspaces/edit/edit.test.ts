import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { WorkspaceStore } from '../workspace.store'
import { editWorkspace } from './edit.contract'
import { editWorkspaceController } from './edit.controller'

let folder: string

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'aether-edit-'))
})

afterEach(() => rm(folder, { recursive: true, force: true }))

function setup() {
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  const { database } = opened.value
  const store = new WorkspaceStore(database)
  store.insert({
    id: 'w1',
    name: 'Work',
    root: join(folder, 'old-root'),
    github: { login: 'example-user', name: 'Example User', avatar: null },
    claudeFolder: null,
    claudeProfile: null,
    createdAt: '2026-01-01T00:00:00.000Z'
  })
  return { edit: editWorkspaceController(database), store }
}

const settings = (root: string) => ({
  id: 'w1',
  name: 'Client',
  root,
  github: null,
  claudeFolder: null,
  claudeProfile: null
})

describe('workspaces.edit', () => {
  it('saves the name, the root, the GitHub account, the Claude folder and the Claude profile', async () => {
    const { edit, store } = setup()
    const claudeFolder = join(folder, 'claude')
    const result = await edit({
      ...settings(folder),
      github: { login: 'example-two', name: null, avatar: null },
      claudeFolder,
      claudeProfile: 'client'
    })
    expect(result).toEqual({ ok: true, value: {} })
    expect(editWorkspace.output.safeParse(result).success).toBe(true)
    expect(store.find('w1')).toEqual({
      id: 'w1',
      name: 'Client',
      root: folder,
      github: { login: 'example-two', name: null, avatar: null },
      claudeFolder,
      claudeProfile: 'client',
      createdAt: '2026-01-01T00:00:00.000Z'
    })
  })

  it('removes the GitHub account, the Claude folder and the Claude profile when the user clears them', async () => {
    const { edit, store } = setup()
    await edit({ ...settings(folder), claudeFolder: join(folder, 'claude'), claudeProfile: 'client' })
    await edit(settings(folder))
    expect(store.find('w1')).toMatchObject({ github: null, claudeFolder: null, claudeProfile: null })
  })

  it('refuses a new root that is not an existing folder, and changes nothing', async () => {
    const { edit, store } = setup()
    const result = await edit(settings(join(folder, 'missing')))
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-root' } })
    expect(store.find('w1')).toMatchObject({ name: 'Work', root: join(folder, 'old-root') })
  })

  it('keeps an unchanged root whose folder is gone, so that the user can still edit the name', async () => {
    const { edit, store } = setup()
    expect(await edit(settings(join(folder, 'old-root')))).toMatchObject({ ok: true })
    expect(store.find('w1')).toMatchObject({ name: 'Client' })
  })

  it('refuses a Claude folder that is not an absolute path', async () => {
    const { edit } = setup()
    expect(await edit({ ...settings(folder), claudeFolder: 'claude' })).toMatchObject({
      ok: false,
      error: { code: 'invalid-claude-folder' }
    })
  })

  it('refuses a workspace that does not exist', async () => {
    const { edit } = setup()
    expect(await edit({ ...settings(folder), id: 'missing' })).toMatchObject({
      ok: false,
      error: { code: 'unknown-workspace' }
    })
  })
})
