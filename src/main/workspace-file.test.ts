import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { emptyWorkspace, reduce } from '../shared/model'
import { WorkspaceFile } from './workspace-file'

let folder: string
let path: string

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'aether-'))
  path = join(folder, 'workspace.json')
})

afterEach(() => rm(folder, { recursive: true, force: true }))

const named = (name: string) =>
  reduce(emptyWorkspace, { type: 'project-added', id: name, name, at: '2026-01-01T00:00:00.000Z' })

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
