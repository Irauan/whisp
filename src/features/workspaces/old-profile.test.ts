import { describe, expect, it } from 'vitest'
import { modeOf, readOldProfile } from './old-profile'

const at = '2026-01-01T00:00:00.000Z'

const settings = (extra: Record<string, unknown> = {}) => ({
  folder: 'C:\\code\\one',
  mode: 'interactive',
  permissions: 'ask',
  model: 'default',
  checkout: 'folder',
  attachments: [],
  ...extra
})

const session = (extra: Record<string, unknown> = {}, settingsExtra: Record<string, unknown> = {}) => ({
  id: 's1',
  accountId: 'personal',
  title: 'Say hello',
  prompt: 'Say hello',
  settings: settings(settingsExtra),
  createdAt: at,
  ...extra
})

const profile = (extra: Record<string, unknown> = {}) => ({
  version: 4,
  accounts: [{ id: 'personal', label: 'Personal', github: null }],
  currentAccountId: 'personal',
  projects: [{ id: 'p1', accountId: 'personal', name: 'One', path: 'C:\\code\\one', createdAt: at }],
  workItems: [{ id: 'w1', projectId: 'p1', title: 'Task' }],
  sessions: [],
  ...extra
})

const read = (value: unknown) => readOldProfile(JSON.stringify(value))

describe('modeOf: the import order of the brief', () => {
  it.each([
    // Plan comes first, whatever the permissions are.
    ['plan', 'all', 'plan'],
    ['plan', 'assisted', 'plan'],
    ['plan', 'ask', 'plan'],
    // Autopilot comes before Approve all.
    ['autopilot', 'all', 'auto'],
    ['autopilot', 'ask', 'auto'],
    // Approve all comes before Assisted.
    ['interactive', 'all', 'approve-all'],
    ['interactive', 'assisted', 'auto'],
    ['interactive', 'ask', 'ask'],
    // Anything else is Ask.
    ['unknown', 'unknown', 'ask'],
    ['', '', 'ask']
  ])('maps the mode %s with the permissions %s to %s', (mode, permissions, expected) => {
    expect(modeOf(mode, permissions)).toBe(expected)
  })
})

describe('readOldProfile', () => {
  it('reads the accounts, the current account and the drafts of a file of version 4', () => {
    const github = { login: 'example-user', name: 'Example User', avatar: 'data:image/png;base64,AAAA' }
    const result = read(
      profile({
        accounts: [
          { id: 'personal', label: ' Personal ', github: null },
          { id: 'client', label: 'Client', github }
        ],
        currentAccountId: 'client',
        sessions: [
          session({ id: 's1', accountId: 'client', title: 'Fix login', prompt: 'Fix login\nUse OAuth' }, {
            mode: 'autopilot',
            permissions: 'all',
            model: 'claude-opus-5-5',
            attachments: [{ kind: 'file', ref: 'C:\\notes.txt', label: 'notes.txt', extra: 1 }]
          })
        ]
      })
    )
    expect(result).toEqual({
      accounts: [
        { id: 'personal', label: 'Personal', github: null },
        { id: 'client', label: 'Client', github }
      ],
      currentAccountId: 'client',
      drafts: [
        {
          accountId: 'client',
          title: 'Fix login',
          prompt: 'Fix login\nUse OAuth',
          mode: 'auto',
          folder: 'C:\\code\\one',
          model: 'claude-opus-5-5',
          attachments: [{ kind: 'file', ref: 'C:\\notes.txt', label: 'notes.txt' }],
          createdAt: at
        }
      ]
    })
  })

  it('keeps no old project and no old work item', () => {
    expect(JSON.stringify(read(profile()))).not.toContain('Task')
    expect(JSON.stringify(read(profile()))).not.toContain('One')
  })

  it('fills a GitHub account that has no name and no avatar', () => {
    const result = read(profile({ accounts: [{ id: 'personal', label: 'Personal', github: { login: 'example-user' } }] }))
    expect(result?.accounts[0]?.github).toEqual({ login: 'example-user', name: null, avatar: null })
  })

  it('skips a draft of an account that does not exist', () => {
    expect(read(profile({ sessions: [session({ accountId: 'gone' }), session()] }))?.drafts).toHaveLength(1)
  })

  it('reads the files of a draft of version 3 as attachments', () => {
    const old = session({}, { files: ['C:\\tmp\\a.txt'], attachments: undefined })
    const result = read(profile({ version: 3, sessions: [old] }))
    expect(result?.drafts[0]?.attachments).toEqual([{ kind: 'file', ref: 'C:\\tmp\\a.txt', label: 'a.txt' }])
  })

  it('gives a default to a field that an early version of the old Aether did not write', () => {
    const early = { id: 's1', accountId: 'personal', prompt: 'Say hello\nPlease', settings: { folder: 'C:\\code\\one' } }
    const result = read(
      profile({ accounts: [{ id: 'personal', label: 'Personal' }], sessions: [early] })
    )
    expect(result?.accounts[0]?.github).toBeNull()
    expect(result?.drafts).toEqual([
      {
        accountId: 'personal',
        title: 'Say hello',
        prompt: 'Say hello\nPlease',
        mode: 'ask',
        folder: 'C:\\code\\one',
        model: 'default',
        attachments: [],
        createdAt: null
      }
    ])
  })

  it('gives a draft of version 3 without files no attachments', () => {
    const old = session({}, { attachments: undefined })
    expect(read(profile({ version: 3, sessions: [old] }))?.drafts[0]?.attachments).toEqual([])
  })

  it('reads a file of version 2, which has no drafts', () => {
    const { sessions: _sessions, ...old } = profile({ version: 2 })
    expect(read(old)).toMatchObject({ currentAccountId: 'personal', drafts: [] })
  })

  it('gives a file of version 1 the first account', () => {
    expect(read({ version: 1, projects: [], workItems: [] })).toEqual({
      accounts: [{ id: 'personal', label: 'Personal', github: null }],
      currentAccountId: 'personal',
      drafts: []
    })
  })

  it.each([
    ['text that is not JSON', '{"version":4,"accounts":[{"id":"personal"\r\n'],
    ['an empty file', ''],
    ['JSON that is not an object', '[]'],
    ['an unknown version', JSON.stringify(profile({ version: 5 }))],
    ['a current account that does not exist', JSON.stringify(profile({ currentAccountId: 'none' }))],
    ['no account', JSON.stringify(profile({ accounts: [], currentAccountId: 'personal' }))],
    ['an account without a name', JSON.stringify(profile({ accounts: [{ id: 'personal', label: ' ', github: null }] }))],
    ['a draft without a prompt', JSON.stringify(profile({ sessions: [session({ prompt: undefined })] }))],
    ['a draft without settings', JSON.stringify(profile({ sessions: [session({ settings: undefined })] }))],
    ['a draft without a folder', JSON.stringify(profile({ sessions: [session({}, { folder: undefined })] }))],
    ['a draft without an account', JSON.stringify(profile({ sessions: [session({ accountId: undefined })] }))],
    ['a version 1 file without projects', JSON.stringify({ version: 1 })]
  ])('refuses %s, and never reads it as empty', (_name, text) => {
    expect(readOldProfile(text)).toBeNull()
  })
})
