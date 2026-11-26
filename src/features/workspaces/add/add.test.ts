import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { WorkspaceStore } from '../workspace.store'
import { addWorkspace } from './add.contract'
import { addWorkspaceController } from './add.controller'

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
  const add = addWorkspaceController(
    database,
    { now: () => new Date('2026-01-02T03:04:05.000Z') },
    { next: () => `id-${(count += 1)}` }
  )
  return { add, store: new WorkspaceStore(database) }
}

const input = (root: string) => ({ name: 'Work', root, github: null, claudeFolder: null, claudeProfile: null })

describe('workspaces.add', () => {
  it('saves the workspace and makes it the current one', async () => {
    const { add, store } = setup()
    const github = { login: 'example-user', name: 'Example User', avatar: 'data:image/png;base64,AAAA' }
    const claudeFolder = join(folder, 'claude')
    const result = await add({ ...input(folder), github, claudeFolder, claudeProfile: 'work' })
    expect(result).toEqual({ ok: true, value: { id: 'id-1' } })
    expect(addWorkspace.output.safeParse(result).success).toBe(true)
    expect(store.find('id-1')).toEqual({
      id: 'id-1',
      name: 'Work',
      root: folder,
      github,
      claudeFolder,
      claudeProfile: 'work',
      createdAt: '2026-01-02T03:04:05.000Z'
    })
    expect(store.currentId()).toBe('id-1')

    await add(input(folder))
    expect(store.currentId()).toBe('id-2')
    expect(store.list()).toHaveLength(2)
  })

  it('refuses a root that is not an existing folder, and saves nothing', async () => {
    const { add, store } = setup()
    const file = join(folder, 'a-file.txt')
    await writeFile(file, 'x')
    for (const root of [join(folder, 'missing'), file, 'relative\\folder']) {
      expect(await add(input(root))).toMatchObject({ ok: false, error: { code: 'invalid-root' } })
    }
    expect(store.list()).toEqual([])
  })

  it('refuses a Claude folder that is not an absolute path', async () => {
    const { add, store } = setup()
    const result = await add({ ...input(folder), claudeFolder: 'claude' })
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-claude-folder' } })
    expect(addWorkspace.output.safeParse(result).success).toBe(true)
    expect(store.list()).toEqual([])
  })
})
