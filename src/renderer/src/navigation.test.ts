import { expect, it } from 'vitest'
import { push, step, type History } from './navigation'

const start: History = { entries: [{ kind: 'home' }], index: 0 }

it('drops the forward entries on a new visit', () => {
  const visited = push(push(start, { kind: 'items' }), { kind: 'pulls' })
  const next = push(step(visited, -1), { kind: 'projects' })
  expect(next.entries.map((view) => view.kind)).toEqual(['home', 'items', 'projects'])
})

it('ignores a visit to the current view', () => {
  expect(push(start, { kind: 'home' })).toBe(start)
})

it('stops at both ends', () => {
  expect(step(start, -1)).toBe(start)
  expect(step(start, 1)).toBe(start)
})

it('takes the New page with a folder as another view than the New page without one', () => {
  const withFolder = push(start, { kind: 'home', folder: 'C:\\work\\repo-b' })
  expect(withFolder.entries).toHaveLength(2)
  expect(push(withFolder, { kind: 'home', folder: 'C:\\work\\repo-b' })).toBe(withFolder)
  expect(push(withFolder, { kind: 'home' }).entries).toHaveLength(3)
})
