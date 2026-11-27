import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { ProfileStore } from '../profile.store'
import { chooseDirectories } from './choose-directories.contract'
import { chooseDirectoriesController } from './choose-directories.controller'

let folder: string

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'aether-directories-'))
})

afterEach(() => rm(folder, { recursive: true, force: true }))

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
      createdAt: '2026-01-01T00:00:00.000Z'
    })
  }
  return { choose: chooseDirectoriesController(database), store }
}

describe('profiles.choose-directories', () => {
  it('saves the workspace directory of each profile', async () => {
    const { choose, store } = setup()
    const first = join(folder, 'first')
    const second = join(folder, 'second')
    await mkdir(first)
    await mkdir(second)
    const result = await choose({
      directories: [
        { profileId: 'w1', workspaceDirectory: first },
        { profileId: 'w2', workspaceDirectory: second }
      ]
    })
    expect(result).toEqual({ ok: true, value: {} })
    expect(chooseDirectories.output.safeParse(result).success).toBe(true)
    expect(store.list().map((profile) => profile.workspaceDirectory)).toEqual([first, second])
  })

  it('saves no workspace directory when one workspace directory is not an existing folder', async () => {
    const { choose, store } = setup()
    const result = await choose({
      directories: [
        { profileId: 'w1', workspaceDirectory: folder },
        { profileId: 'w2', workspaceDirectory: join(folder, 'missing') }
      ]
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-workspace-directory' } })
    expect(store.list().map((profile) => profile.workspaceDirectory)).toEqual([null, null])
  })

  it('saves no workspace directory when one profile does not exist', async () => {
    const { choose, store } = setup()
    const result = await choose({
      directories: [
        { profileId: 'w1', workspaceDirectory: folder },
        { profileId: 'missing', workspaceDirectory: folder }
      ]
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'unknown-profile' } })
    expect(store.list().map((profile) => profile.workspaceDirectory)).toEqual([null, null])
  })
})
