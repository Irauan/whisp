import { describe, expect, it } from 'vitest'
import {
  baseName,
  contentOf,
  emptyWorkspace,
  isWorkspace,
  parseRequest,
  readWorkspace,
  reduce,
  type SessionSettings,
  type Workspace
} from './model'

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

  it('keeps the folder of a project', () => {
    const added = reduce(emptyWorkspace, { type: 'project-added', id: 'p1', name: 'One', path: '/code/one', at })
    expect(added.projects[0]?.path).toBe('/code/one')
    const moved = reduce(added, { type: 'project-folder-set', id: 'p1', path: '/code/two' })
    expect(moved.projects[0]?.path).toBe('/code/two')
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
    expect(isWorkspace({ ...seeded(), currentAccountId: 'none' })).toBe(false)
    expect(isWorkspace({ ...seeded(), version: 5 })).toBe(false)
    expect(isWorkspace(null)).toBe(false)
  })
})

describe('accounts', () => {
  const withWork = () => {
    const added = reduce(seeded(), { type: 'account-added', id: 'work', label: 'Work', github: null })
    return reduce(added, { type: 'project-added', id: 'p2', name: 'Two', at })
  }

  it('switches to a new account and keeps the projects apart', () => {
    const state = withWork()
    expect(state.currentAccountId).toBe('work')
    expect(contentOf(state, 'work').projects.map((project) => project.id)).toEqual(['p2'])
    expect(contentOf(state, 'work').workItems).toEqual([])
    expect(contentOf(state, 'personal').workItems.map((item) => item.id)).toEqual(['w1'])
  })

  it('refuses a switch to an unknown account', () => {
    const state = withWork()
    expect(reduce(state, { type: 'account-switched', id: 'none' })).toBe(state)
  })

  it('edits only the given account', () => {
    const github = { login: 'octocat', name: null, avatar: null }
    const next = reduce(withWork(), { type: 'account-edited', id: 'work', label: 'Job', github })
    expect(next.accounts).toEqual([
      emptyWorkspace.accounts[0],
      { id: 'work', label: 'Job', github }
    ])
  })

  it('deletes the content of a deleted account and switches away', () => {
    expect(reduce(withWork(), { type: 'account-deleted', id: 'work' })).toEqual(seeded())
    const next = reduce(withWork(), { type: 'account-deleted', id: 'personal' })
    expect(next.currentAccountId).toBe('work')
    expect(next.projects.map((project) => project.id)).toEqual(['p2'])
    expect(next.workItems).toEqual([])
  })

  it('keeps the last account', () => {
    expect(reduce(seeded(), { type: 'account-deleted', id: 'personal' })).toEqual(seeded())
  })
})

describe('sessions', () => {
  const settings: SessionSettings = {
    folder: 'C:\\work\\app',
    mode: 'plan',
    permissions: 'ask',
    model: 'default',
    checkout: 'folder',
    attachments: []
  }
  const withSession = () =>
    reduce(seeded(), {
      type: 'session-added',
      id: 's1',
      prompt: 'Fix login\nUse OAuth',
      settings,
      at
    })

  it('belongs to the current account and takes its title from the first line', () => {
    expect(contentOf(withSession(), 'personal').sessions).toEqual([
      {
        id: 's1',
        accountId: 'personal',
        title: 'Fix login',
        prompt: 'Fix login\nUse OAuth',
        settings,
        createdAt: at
      }
    ])
    expect(contentOf(withSession(), 'work').sessions).toEqual([])
  })

  it('refuses a blank prompt', () => {
    const state = seeded()
    expect(reduce(state, { type: 'session-added', id: 's1', prompt: ' ', settings, at })).toBe(state)
  })

  it('leaves with the session or the account', () => {
    expect(reduce(withSession(), { type: 'session-deleted', id: 's1' })).toEqual(seeded())
    const two = reduce(withSession(), { type: 'account-added', id: 'work', label: 'Work', github: null })
    expect(reduce(two, { type: 'account-deleted', id: 'work' }).sessions).toHaveLength(1)
    expect(reduce(two, { type: 'account-deleted', id: 'personal' }).sessions).toEqual([])
  })
})

it('reads the last part of a path', () => {
  expect(baseName('C:\\work\\app\\')).toBe('app')
  expect(baseName('/home/me/app')).toBe('app')
  expect(baseName('/')).toBe('/')
})

describe('readWorkspace', () => {
  it('turns the files of version 3 sessions into attachments', () => {
    const session = { id: 's1', settings: { folder: '/app', files: ['/tmp/a.txt'] } }
    expect(readWorkspace({ ...seeded(), version: 3, sessions: [session] })?.sessions).toEqual([
      {
        id: 's1',
        settings: {
          folder: '/app',
          attachments: [{ kind: 'file', ref: '/tmp/a.txt', label: 'a.txt' }]
        }
      }
    ])
  })

  it('adds an empty session list to version 2 data', () => {
    const { sessions: _, ...old } = seeded()
    expect(readWorkspace({ ...old, version: 2 })).toEqual(seeded())
  })

  it('moves version 1 data to the first account', () => {
    const { projects, workItems } = seeded()
    const old = {
      version: 1,
      projects: projects.map(({ accountId: _, ...project }) => project),
      workItems
    }
    expect(readWorkspace(old)).toEqual(seeded())
  })

  it('refuses other data', () => {
    expect(readWorkspace({ version: 1 })).toBeNull()
    expect(readWorkspace({ version: 1, projects: [] })).toBeNull()
  })
})
