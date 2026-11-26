import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { emptyWorkspace, reduce, type Workspace } from '../shared/model'
import { WorkspaceFile } from './workspace-file'

let folder: string
let path: string

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'aether-'))
  path = join(folder, 'workspace.json')
})

afterEach(() => rm(folder, { recursive: true, force: true }))

const at = '2026-01-01T00:00:00.000Z'

const named = (name: string) =>
  reduce(emptyWorkspace, { type: 'account-edited', id: 'personal', label: name, github: null })

it('starts empty without a file', async () => {
  expect(await new WorkspaceFile(path).load()).toEqual(emptyWorkspace)
})

it('keeps the last of several saves', async () => {
  const file = new WorkspaceFile(path)
  await Promise.all([file.save(named('a')), file.save(named('b'))])
  expect(await new WorkspaceFile(path).load()).toEqual(named('b'))
})

it('keeps a copy of an unreadable file', async () => {
  await writeFile(path, '{broken')
  expect(await new WorkspaceFile(path).load()).toEqual(emptyWorkspace)
  const [copy = ''] = await readdir(folder)
  expect(copy).toContain('workspace.json.unreadable-')
  expect(await readFile(join(folder, copy), 'utf8')).toBe('{broken')
})

// Decision 0005: S1 still saves workspace.json, and a save must keep the old data of projects and
// work items exactly as it was read.
it('writes the old projects and work items back as they were read', async () => {
  const old = {
    version: 4,
    accounts: [{ id: 'personal', label: 'Personal', github: null }],
    currentAccountId: 'personal',
    projects: [{ id: 'p1', accountId: 'personal', name: 'One', path: '/code/one', createdAt: at, future: [1, { a: 2 }] }],
    workItems: [
      { id: 'w1', projectId: 'p1', title: 'Task', description: 'x', stage: 'build', history: [{ stage: 'spec', at }], createdAt: at, future: null }
    ],
    sessions: []
  }
  await writeFile(path, JSON.stringify(old, null, 2))

  const file = new WorkspaceFile(path)
  let state: Workspace = await file.load()
  state = reduce(state, { type: 'account-added', id: 'work', label: 'Work', github: null })
  state = reduce(state, {
    type: 'session-added',
    id: 's1',
    prompt: 'Say hello',
    settings: {
      folder: '/code/one',
      mode: 'interactive',
      permissions: 'ask',
      model: 'default',
      checkout: 'folder',
      attachments: []
    },
    at
  })
  state = reduce(state, { type: 'account-deleted', id: 'personal' })
  await file.save(state)

  const saved = JSON.parse(await readFile(path, 'utf8')) as Workspace
  expect(saved.projects).toEqual(old.projects)
  expect(saved.workItems).toEqual(old.workItems)
  expect(saved.accounts.map((account) => account.id)).toEqual(['work'])
})
