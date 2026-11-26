import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { WorkspaceStore } from '../workspace.store'
import { chooseRoots } from './choose-roots.contract'
import { chooseRootsController } from './choose-roots.controller'

let folder: string

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'aether-roots-'))
})

afterEach(() => rm(folder, { recursive: true, force: true }))

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
  return { choose: chooseRootsController(database), store }
}

describe('workspaces.choose-roots', () => {
  it('saves the root of each workspace', async () => {
    const { choose, store } = setup()
    const first = join(folder, 'first')
    const second = join(folder, 'second')
    await mkdir(first)
    await mkdir(second)
    const result = await choose({
      roots: [
        { workspaceId: 'w1', root: first },
        { workspaceId: 'w2', root: second }
      ]
    })
    expect(result).toEqual({ ok: true, value: {} })
    expect(chooseRoots.output.safeParse(result).success).toBe(true)
    expect(store.list().map((workspace) => workspace.root)).toEqual([first, second])
  })

  it('saves no root when one root is not an existing folder', async () => {
    const { choose, store } = setup()
    const result = await choose({
      roots: [
        { workspaceId: 'w1', root: folder },
        { workspaceId: 'w2', root: join(folder, 'missing') }
      ]
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid-root' } })
    expect(store.list().map((workspace) => workspace.root)).toEqual([null, null])
  })

  it('saves no root when one workspace does not exist', async () => {
    const { choose, store } = setup()
    const result = await choose({
      roots: [
        { workspaceId: 'w1', root: folder },
        { workspaceId: 'missing', root: folder }
      ]
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'unknown-workspace' } })
    expect(store.list().map((workspace) => workspace.root)).toEqual([null, null])
  })
})
