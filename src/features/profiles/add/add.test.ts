import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { ProfileStore } from '../profile.store'
import { addProfile } from './add.contract'
import { addProfileController } from './add.controller'

let folder: string

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'aether-add-'))
})

afterEach(() => rm(folder, { recursive: true, force: true }))

function setup() {
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  const { database } = opened.value
  let count = 0
  const add = addProfileController(
    database,
    { now: () => new Date('2026-01-02T03:04:05.000Z') },
    { next: () => `id-${(count += 1)}` }
  )
  return { add, database, store: new ProfileStore(database) }
}

const input = (workspaceDirectory: string) => ({ name: 'Work', workspaceDirectory, github: null, claudeFolder: null })

describe('profiles.add', () => {
  it('saves the profile and makes it the current one', async () => {
    const { add, database, store } = setup()
    const github = { login: 'example-user', name: 'Example User', avatar: 'data:image/png;base64,AAAA' }
    const claudeFolder = join(folder, 'claude')
    const result = await add({ ...input(folder), github, claudeFolder })
    expect(result).toEqual({ ok: true, value: { id: 'id-1' } })
    expect(addProfile.output.safeParse(result).success).toBe(true)
    expect(store.find('id-1')).toEqual({
      id: 'id-1',
      name: 'Work',
      workspaceDirectory: folder,
      github,
      claudeFolder,
      createdAt: '2026-01-02T03:04:05.000Z'
    })
    expect(store.currentId()).toBe('id-1')

    // The Claude settings are in one provider row of the profile: id-2.
    expect(database.prepare('SELECT id, profile_id, kind, settings FROM providers').all()).toEqual([
      { id: 'id-2', profile_id: 'id-1', kind: 'claude-code', settings: JSON.stringify({ configFolder: claudeFolder }) }
    ])

    await add(input(folder))
    expect(store.currentId()).toBe('id-3')
    expect(store.list()).toHaveLength(2)
    // A profile without Claude settings has no provider row.
    expect(database.prepare('SELECT count(*) AS total FROM providers').get()).toMatchObject({ total: 1 })
  })

  it('refuses a workspace directory that is not an existing folder, and saves nothing', async () => {
    const { add, store } = setup()
    const file = join(folder, 'a-file.txt')
    await writeFile(file, 'x')
    for (const workspaceDirectory of [join(folder, 'missing'), file, 'relative\\folder']) {
      expect(await add(input(workspaceDirectory))).toMatchObject({ ok: false, error: { code: 'invalid-workspace-directory' } })
    }
    expect(store.list()).toEqual([])
  })

  it('refuses a Claude folder that is not an absolute path', async () => {
    const { add, store } = setup()
    const result = await add({ ...input(folder), claudeFolder: 'claude' })
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-claude-folder' } })
    expect(addProfile.output.safeParse(result).success).toBe(true)
    expect(store.list()).toEqual([])
  })
})
