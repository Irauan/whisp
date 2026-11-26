import { describe, expect, it } from 'vitest'
import {
  baseName,
  contentOf,
  emptyWorkspace,
  isWorkspace,
  parseRequest,
  readWorkspace,
  reduce,
  type Action,
  type SessionSettings,
  type Workspace
} from './model'

const at = '2026-01-01T00:00:00.000Z'

/** Old data of version 4, with a field that the code does not know. Decision 0005 keeps it. */
const oldProjects = [{ id: 'p1', accountId: 'personal', name: 'One', path: '/code/one', createdAt: at, extra: { a: 1 } }]
const oldWorkItems = [
  { id: 'w1', projectId: 'p1', title: 'Task', description: '', stage: 'build', history: [{ stage: 'build', at }] }
]

function seeded(): Workspace {
  return { ...emptyWorkspace, projects: oldProjects, workItems: oldWorkItems }
}

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
    expect(isWorkspace({ ...seeded(), projects: undefined })).toBe(false)
    expect(isWorkspace({ ...seeded(), currentAccountId: 'none' })).toBe(false)
    expect(isWorkspace({ ...seeded(), version: 5 })).toBe(false)
    expect(isWorkspace(null)).toBe(false)
  })
})

describe('accounts', () => {
  const withWork = () => reduce(seeded(), { type: 'account-added', id: 'work', label: 'Work', github: null })

  it('switches to a new account', () => {
    expect(withWork().currentAccountId).toBe('work')
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

  it('deletes a deleted account and switches away', () => {
    expect(reduce(withWork(), { type: 'account-deleted', id: 'work' })).toEqual(seeded())
    const next = reduce(withWork(), { type: 'account-deleted', id: 'personal' })
    expect(next.currentAccountId).toBe('work')
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
    const old = {
      version: 1,
      projects: oldProjects.map(({ accountId: _, ...project }) => project),
      workItems: oldWorkItems
    }
    expect(readWorkspace(old)).toEqual(seeded())
  })

  it('refuses other data', () => {
    expect(readWorkspace({ version: 1 })).toBeNull()
    expect(readWorkspace({ version: 1, projects: [] })).toBeNull()
  })
})

describe('the old projects and work items (decision 0005)', () => {
  const settings: SessionSettings = {
    folder: '/code/one',
    mode: 'interactive',
    permissions: 'ask',
    model: 'default',
    checkout: 'folder',
    attachments: []
  }
  const actions: Action[] = [
    { type: 'account-added', id: 'third', label: 'Third', github: null },
    { type: 'account-edited', id: 'personal', label: 'Home', github: null },
    { type: 'account-switched', id: 'personal' },
    { type: 'session-added', id: 's1', prompt: 'Say hello', settings, at },
    { type: 'session-deleted', id: 's1' },
    { type: 'account-deleted', id: 'personal' }
  ]

  it.each(actions.map((action) => [action.type, action] as const))(
    'stay the same after %s, and the result is still a workspace',
    (_name, action) => {
      // The account "work" exists, so that each action does something.
      const before = reduce(seeded(), { type: 'account-added', id: 'work', label: 'Work', github: null })
      const after = reduce(before, action)
      expect(after.projects).toBe(before.projects)
      expect(after.workItems).toBe(before.workItems)
      expect(isWorkspace(after)).toBe(true)
    }
  )

  it('stay in the workspace of a deleted account', () => {
    const two = reduce(seeded(), { type: 'account-added', id: 'work', label: 'Work', github: null })
    const next = reduce(two, { type: 'account-deleted', id: 'personal' })
    expect(next.accounts.map((account) => account.id)).toEqual(['work'])
    expect(next.projects).toEqual(oldProjects)
    expect(next.workItems).toEqual(oldWorkItems)
  })

  it('load unchanged from a file of version 4', () => {
    const loaded = readWorkspace(JSON.parse(JSON.stringify(seeded())))
    expect(loaded?.projects).toEqual(oldProjects)
    expect(loaded?.workItems).toEqual(oldWorkItems)
  })
})
