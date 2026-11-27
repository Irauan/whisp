import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { ProfileStore } from '../profile.store'
import { editProfile } from './edit.contract'
import { AccountsInStart } from '../../../building-blocks/accounts-in-start'
import { editProfileController } from './edit.controller'

let folder: string

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'aether-edit-'))
})

afterEach(() => rm(folder, { recursive: true, force: true }))

function setup() {
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  const { database } = opened.value
  const store = new ProfileStore(database)
  store.insert({
    id: 'w1',
    name: 'Work',
    workspaceDirectory: join(folder, 'old-directory'),
    github: { login: 'example-user', name: 'Example User', avatar: null },
    claudeFolder: null,
    claudeProfileName: null,
    createdAt: '2026-01-01T00:00:00.000Z'
  })
  return { edit: editProfileController(database, { now: () => new Date("2026-01-02T03:04:05.000Z") }, { next: () => "provider-1" }, new AccountsInStart()), database, store }
}

const settings = (workspaceDirectory: string) => ({
  id: 'w1',
  name: 'Client',
  workspaceDirectory,
  github: null,
  claudeFolder: null,
  claudeProfileName: null
})

describe('profiles.edit', () => {
  it('saves the name, the workspace directory, the GitHub account, the Claude folder and the Claude profile name', async () => {
    const { edit, database, store } = setup()
    const claudeFolder = join(folder, 'claude')
    const result = await edit({
      ...settings(folder),
      github: { login: 'example-two', name: null, avatar: null },
      claudeFolder,
      claudeProfileName: 'client'
    })
    expect(result).toEqual({ ok: true, value: {} })
    expect(editProfile.output.safeParse(result).success).toBe(true)
    expect(store.find('w1')).toEqual({
      id: 'w1',
      name: 'Client',
      workspaceDirectory: folder,
      github: { login: 'example-two', name: null, avatar: null },
      claudeFolder,
      claudeProfileName: 'client',
      createdAt: '2026-01-01T00:00:00.000Z'
    })
    // The Claude settings are in the provider row, and the profiles table holds no Claude column.
    expect(database.prepare('SELECT id, kind, settings FROM providers').all()).toEqual([
      { id: 'provider-1', kind: 'claude-code', settings: JSON.stringify({ configFolder: claudeFolder, profileName: 'client' }) }
    ])
  })

  it('keeps the provider row, with empty settings, when the user clears the Claude settings, because a session can refer to it', async () => {
    const { edit, database, store } = setup()
    await edit({ ...settings(folder), claudeFolder: join(folder, 'claude'), claudeProfileName: 'client' })
    await edit(settings(folder))
    expect(database.prepare('SELECT id, settings FROM providers').all()).toEqual([{ id: 'provider-1', settings: '{}' }])
    expect(store.find('w1')).toMatchObject({ claudeFolder: null, claudeProfileName: null })
  })

  it('makes no provider row when the user chose no Claude setting', async () => {
    const { edit, database } = setup()
    await edit(settings(folder))
    expect(database.prepare('SELECT count(*) AS total FROM providers').get()).toMatchObject({ total: 0 })
  })

  it('removes the GitHub account, the Claude folder and the Claude profile when the user clears them', async () => {
    const { edit, store } = setup()
    await edit({ ...settings(folder), claudeFolder: join(folder, 'claude'), claudeProfileName: 'client' })
    await edit(settings(folder))
    expect(store.find('w1')).toMatchObject({ github: null, claudeFolder: null, claudeProfileName: null })
  })

  it('refuses a new workspace directory that is not an existing folder, and changes nothing', async () => {
    const { edit, store } = setup()
    const result = await edit(settings(join(folder, 'missing')))
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-workspace-directory' } })
    expect(store.find('w1')).toMatchObject({ name: 'Work', workspaceDirectory: join(folder, 'old-directory') })
  })

  it('keeps an unchanged workspace directory whose folder is gone, so that the user can still edit the name', async () => {
    const { edit, store } = setup()
    expect(await edit(settings(join(folder, 'old-directory')))).toMatchObject({ ok: true })
    expect(store.find('w1')).toMatchObject({ name: 'Client' })
  })

  it('refuses a Claude folder that is not an absolute path', async () => {
    const { edit } = setup()
    expect(await edit({ ...settings(folder), claudeFolder: 'claude' })).toMatchObject({
      ok: false,
      error: { code: 'invalid-claude-folder' }
    })
  })

  it('refuses a profile that does not exist', async () => {
    const { edit } = setup()
    expect(await edit({ ...settings(folder), id: 'missing' })).toMatchObject({
      ok: false,
      error: { code: 'unknown-profile' }
    })
  })
})
