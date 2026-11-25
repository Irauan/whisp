import { describe, expect, it } from 'vitest'
import { emptyWorkspace, isWorkspace, parseRequest, reduce, type Workspace } from './model'

const at = '2026-01-01T00:00:00.000Z'
const later = '2026-01-02T00:00:00.000Z'

function seeded(): Workspace {
  const withProject = reduce(emptyWorkspace, { type: 'project-added', id: 'p1', name: 'One', at })
  return reduce(withProject, {
    type: 'item-added',
    id: 'w1',
    projectId: 'p1',
    title: 'Task',
    description: '',
    at
  })
}

describe('reduce', () => {
  it('starts a work item in the spec stage', () => {
    expect(seeded().workItems[0]).toMatchObject({ stage: 'spec', history: [{ stage: 'spec', at }] })
  })

  it('refuses a work item of an unknown project', () => {
    const next = reduce(emptyWorkspace, {
      type: 'item-added',
      id: 'w1',
      projectId: 'none',
      title: 'Task',
      description: '',
      at
    })
    expect(next.workItems).toEqual([])
  })

  it('records each stage change', () => {
    const next = reduce(seeded(), { type: 'item-moved', id: 'w1', stage: 'build', at: later })
    expect(next.workItems[0]?.history).toEqual([
      { stage: 'spec', at },
      { stage: 'build', at: later }
    ])
  })

  it('does not record a move to the current stage', () => {
    const next = reduce(seeded(), { type: 'item-moved', id: 'w1', stage: 'spec', at: later })
    expect(next.workItems[0]?.history).toHaveLength(1)
  })

  it('deletes the work items of a deleted project', () => {
    expect(reduce(seeded(), { type: 'project-deleted', id: 'p1' })).toEqual(emptyWorkspace)
  })
})

describe('parseRequest', () => {
  it('splits the title from the description', () => {
    expect(parseRequest('  Add login \n\nUse OAuth\n')).toEqual({
      title: 'Add login',
      description: 'Use OAuth'
    })
  })

  it('refuses blank text', () => {
    expect(parseRequest(' \n ')).toBeNull()
  })
})

describe('isWorkspace', () => {
  it('accepts a saved workspace and refuses other data', () => {
    expect(isWorkspace(JSON.parse(JSON.stringify(seeded())))).toBe(true)
    expect(isWorkspace({ version: 2, projects: [], workItems: [] })).toBe(false)
    expect(isWorkspace(null)).toBe(false)
  })
})
