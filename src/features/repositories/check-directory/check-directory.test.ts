import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type Database } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { noFindings, type ProjectFindings, type ProjectScanner } from '../../../building-blocks/project-scanner.port'
import { pathKey } from '../../../building-blocks/paths'
import type { Answer, Question } from '../question'
import { Questions } from '../questions.store'
import { TrustStore } from '../trust.store'
import { checkDirectoryHandler, placementOf, type DirectoryRequest } from './check-directory.handler'

let base: string
let database: Database
let scanned: string[]
let findingsOf: Record<string, ProjectFindings>

beforeEach(() => {
  base = realpathSync.native(mkdtempSync(join(tmpdir(), 'aether-trust-')))
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  database = opened.value.database
  scanned = []
  findingsOf = {}
})

afterEach(() => {
  database.close()
  rmSync(base, { recursive: true, force: true })
})

const folder = (...parts: string[]) => {
  const path = join(base, ...parts)
  mkdirSync(path, { recursive: true })
  return path
}

const repository = (...parts: string[]) => {
  const path = folder(...parts)
  mkdirSync(join(path, '.git'))
  return path
}

const hook = (command = 'node .claude/hooks/session-start.js'): ProjectFindings => ({ ...noFindings(), hooks: [{ event: 'SessionStart', command }] })

function addProfile(id: string, name: string, directory: string | null, claudeFolder?: string) {
  database
    .prepare('INSERT INTO profiles (id, name, workspace_directory, created_at) VALUES (?, ?, ?, ?)')
    .run(id, name, directory, `2026-01-0${id === 'personal' ? 1 : 2}`)
  if (claudeFolder !== undefined) {
    database
      .prepare("INSERT INTO providers (id, profile_id, kind, label, settings, is_current, created_at) VALUES (?, ?, 'claude-code', 'Claude', ?, 1, '2026-01-01')")
      .run(`provider-${id}`, id, JSON.stringify({ configFolder: claudeFolder }))
  }
}

function setup(options: { scanner?: ProjectScanner } = {}) {
  const questions = new Questions(() => undefined, { next: (() => { let n = 0; return () => `q${++n}` })() })
  const store = new TrustStore(database)
  const scanner: ProjectScanner = options.scanner ?? {
    scan: async (path) => {
      scanned.push(path)
      return findingsOf[pathKey(path)] ?? noFindings()
    }
  }
  const deps = { store, questions, scanner, clock: { now: () => new Date('2026-02-01T00:00:00.000Z') } }
  let session = 0
  const check = (request: Partial<DirectoryRequest> & { folder: string }) =>
    checkDirectoryHandler(deps, { sessionId: `s${++session}`, profileId: 'personal', ...request })
  /** Waits for the question of the check. The real scanner reads files, so the wait yields to the event loop and ends after a limit. */
  const nextQuestion = async (): Promise<Question> => {
    const limit = Date.now() + 5000
    while (questions.snapshot().questions.length === 0 && Date.now() < limit) await new Promise<void>((resolve) => setImmediate(resolve))
    const [question] = questions.snapshot().questions
    if (!question) throw new Error('No question opened.')
    return question
  }
  const answer = async (value: Answer): Promise<Question> => {
    const question = await nextQuestion()
    questions.answer(question.sessionId, question.id, value)
    return question
  }
  return { check, questions, store, nextQuestion, answer }
}

describe('placementOf', () => {
  const personal = (workspaceDirectory: string | null) => ({ id: 'personal', name: 'Personal', workspaceDirectory })
  const client = (workspaceDirectory: string | null) => ({ id: 'client', name: 'Client Example', workspaceDirectory })

  it('gives inside for a folder in the workspace directory, also the directory itself', () => {
    const workspace = folder('personal')
    expect(placementOf(pathKey(join(workspace, 'repo-a')), personal(workspace), [])).toEqual({ kind: 'inside' })
    expect(placementOf(pathKey(workspace), personal(workspace), [])).toEqual({ kind: 'inside' })
  })

  it('gives other-profile for a folder in the workspace directory of another profile', () => {
    const own = folder('personal')
    const theirs = folder('client')
    expect(placementOf(pathKey(join(theirs, 'contracts')), personal(own), [client(theirs)])).toEqual({
      kind: 'other-profile',
      profile: client(theirs)
    })
  })

  it('lets the profile that asks win when two profiles share a directory', () => {
    const shared = folder('shared')
    expect(placementOf(pathKey(shared), personal(shared), [client(shared)])).toEqual({ kind: 'inside' })
  })

  it('gives outside for a sibling, for a folder anywhere else, and for every folder of a profile without a directory', () => {
    const workspace = folder('personal')
    const sibling = folder('personal-backup', 'notes')
    expect(placementOf(pathKey(sibling), personal(workspace), [])).toEqual({ kind: 'outside' })
    expect(placementOf(pathKey(folder('personal', 'repo-a')), personal(null), [])).toEqual({ kind: 'outside' })
    expect(placementOf(pathKey(folder('personal', 'repo-a')), null, [])).toEqual({ kind: 'outside' })
  })

  it('gives outside for a ".." path and a junction that leave the directory', () => {
    const workspace = folder('personal')
    const target = folder('elsewhere', 'notes')
    symlinkSync(target, join(workspace, 'linked'), 'junction')
    expect(placementOf(pathKey(join(workspace, '..', 'elsewhere', 'notes')), personal(workspace), [])).toEqual({ kind: 'outside' })
    expect(placementOf(pathKey(join(workspace, 'linked')), personal(workspace), [])).toEqual({ kind: 'outside' })
  })

  it('gives outside for a UNC folder, also when the workspace directory is a UNC path', () => {
    expect(placementOf('\\\\server\\share\\repo', personal('\\\\server\\share'), [])).toEqual({ kind: 'outside' })
  })
})

describe('checkDirectoryHandler: inside the workspace directory', () => {
  it('asks nothing for a plain folder without a hook or an MCP server', async () => {
    const workspace = folder('personal')
    addProfile('personal', 'Personal', workspace)
    const { check, questions } = setup()
    expect(await check({ folder: folder('personal', 'notes') })).toEqual({ ok: true, value: {} })
    expect(questions.snapshot().questions).toEqual([])
  })

  it('asks for trust in a Git repository, lists what it finds, and saves "Trust" for the profile', async () => {
    const workspace = folder('personal')
    addProfile('personal', 'Personal', workspace)
    const repo = repository('personal', 'repo-b')
    findingsOf[pathKey(repo)] = { ...hook(), mcpServers: [{ name: 'example-tools', command: 'node tools/mcp-server.js' }] }
    const { check, answer, store } = setup()

    const result = check({ folder: repo })
    const question = await answer('trust')
    expect(await result).toEqual({ ok: true, value: {} })
    expect(question).toMatchObject({
      kind: 'trust',
      profileName: 'Personal',
      folder: repo,
      repository: 'repo-b',
      hooks: [{ event: 'SessionStart', command: 'node .claude/hooks/session-start.js' }],
      mcpServers: [{ name: 'example-tools', command: 'node tools/mcp-server.js' }]
    })
    expect(store.isTrusted('personal', pathKey(repo))).toBe(true)
  })

  it('asks for trust in a Git repository that has no hook and no server', async () => {
    addProfile('personal', 'Personal', folder('personal'))
    const { check, answer } = setup()
    const result = check({ folder: repository('personal', 'repo-a') })
    expect(await answer('trust')).toMatchObject({ kind: 'trust', hooks: [], mcpServers: [] })
    expect((await result).ok).toBe(true)
  })

  it('asks nothing a second time, also from a folder inside the repository, and not for another repository', async () => {
    addProfile('personal', 'Personal', folder('personal'))
    const repo = repository('personal', 'repo-b')
    const other = repository('personal', 'repo-c')
    const { check, answer, questions } = setup()
    const first = check({ folder: repo })
    await answer('trust')
    await first
    expect((await check({ folder: repo })).ok).toBe(true)
    expect((await check({ folder: folder('personal', 'repo-b', 'packages', 'app') })).ok).toBe(true)
    expect(questions.snapshot().questions).toEqual([])
    const third = check({ folder: other })
    expect(await answer('cancel')).toMatchObject({ kind: 'trust', repository: 'repo-c' })
    expect((await third).ok).toBe(false)
  })

  it('refuses after Cancel with the notice of the brief, and saves nothing', async () => {
    addProfile('personal', 'Personal', folder('personal'))
    const repo = repository('personal', 'repo-b')
    const { check, answer, store } = setup()
    const result = check({ folder: repo })
    await answer('cancel')
    expect(await result).toEqual({ ok: false, error: { code: 'trust-refused', message: 'Aether did not start the agent in this repository.' } })
    expect(store.isTrusted('personal', pathKey(repo))).toBe(false)
  })

  it('shows the items of the repository root and of the session folder inside it, without repeats', async () => {
    addProfile('personal', 'Personal', folder('personal'))
    const repo = repository('personal', 'repo-b')
    const inside = folder('personal', 'repo-b', 'packages', 'app')
    findingsOf[pathKey(repo)] = hook('node root.js')
    findingsOf[pathKey(inside)] = hook('node app.js')
    const { check, answer } = setup()
    void check({ folder: inside })
    expect(await answer('cancel')).toMatchObject({ hooks: [{ command: 'node root.js' }, { command: 'node app.js' }] })
  })

  it('asks for trust in a plain folder with a hook, and trusts that folder only', async () => {
    addProfile('personal', 'Personal', folder('personal'))
    const plain = folder('personal', 'notes-tool')
    findingsOf[pathKey(plain)] = hook()
    const { check, answer, store } = setup()
    const result = check({ folder: plain })
    expect(await answer('trust')).toMatchObject({ kind: 'trust', repository: 'notes-tool' })
    expect((await result).ok).toBe(true)
    expect(store.isTrusted('personal', pathKey(plain))).toBe(true)
  })

  it('asks for trust in a plain folder with an MCP server, and in one with a file that it cannot read', async () => {
    addProfile('personal', 'Personal', folder('personal'))
    const servers = folder('personal', 'with-servers')
    const broken = folder('personal', 'broken')
    findingsOf[pathKey(servers)] = { ...noFindings(), mcpServers: [{ name: 'a', command: null }] }
    findingsOf[pathKey(broken)] = { ...noFindings(), unreadable: ['.mcp.json'] }
    const { check, answer } = setup()
    void check({ folder: servers })
    expect(await answer('cancel')).toMatchObject({ kind: 'trust' })
    void check({ folder: broken })
    expect(await answer('cancel')).toMatchObject({ kind: 'trust', unreadable: ['.mcp.json'] })
  })

  it('keeps the trust of one profile apart from another, also when they share a workspace directory', async () => {
    const shared = folder('shared')
    addProfile('personal', 'Personal', shared)
    addProfile('client', 'Client Example', shared)
    const repo = repository('shared', 'repo-b')
    const { check, answer, store } = setup()
    const first = check({ folder: repo })
    await answer('trust')
    await first
    expect(store.isTrusted('client', pathKey(repo))).toBe(false)
    const second = check({ folder: repo, profileId: 'client' })
    expect(await answer('cancel')).toMatchObject({ kind: 'trust', profileName: 'Client Example' })
    expect((await second).ok).toBe(false)
  })

  it('walks up past the workspace directory: a repository above it asks for trust, and the question lists the files at its root and in the session folder (decision 3)', async () => {
    const top = repository('mono')
    addProfile('personal', 'Personal', folder('mono', 'packages'))
    const inside = folder('mono', 'packages', 'app')
    findingsOf[pathKey(top)] = { ...noFindings(), files: [{ name: '.mcp.json', keys: [] }], mcpServers: [{ name: 'root-server', command: null }] }
    findingsOf[pathKey(inside)] = { ...noFindings(), files: [{ name: join('.claude', 'settings.local.json'), keys: ['env'] }] }
    const { check, answer, store } = setup()
    const result = check({ folder: inside })
    expect(await answer('trust')).toMatchObject({
      kind: 'trust',
      repository: 'mono',
      mcpServers: [{ name: 'root-server' }],
      files: [
        { name: '.mcp.json', keys: [] },
        { name: join('packages', 'app', '.claude', 'settings.local.json'), keys: ['env'] }
      ]
    })
    expect((await result).ok).toBe(true)
    expect(store.isTrusted('personal', pathKey(top))).toBe(true)
    // Trust covers the repository: another folder in it asks nothing.
    expect((await check({ folder: folder('mono', 'packages', 'other') })).ok).toBe(true)
  })

  it('matches the workspace directory and the repository without regard to letter case on Windows', async () => {
    if (process.platform !== 'win32') return
    const workspace = folder('Personal')
    addProfile('personal', 'Personal', workspace.toUpperCase())
    const repo = repository('Personal', 'Repo-B')
    const { check, answer, questions } = setup()
    const first = check({ folder: repo })
    expect(await answer('trust')).toMatchObject({ kind: 'trust' })
    await first
    expect((await check({ folder: repo.toLowerCase() })).ok).toBe(true)
    expect(questions.snapshot().questions).toEqual([])
  })
})

describe('checkDirectoryHandler: outside the workspace directory', () => {
  it('asks the directory question and lists the items that it finds, with no second question', async () => {
    addProfile('personal', 'Personal', folder('personal'))
    const outside = repository('outside', 'repo-x')
    findingsOf[pathKey(outside)] = hook()
    const { check, answer, questions } = setup()
    const result = check({ folder: outside })
    expect(await answer('allow-once')).toMatchObject({ kind: 'outside', profileName: 'Personal', folder: outside, hooks: [{ command: 'node .claude/hooks/session-start.js' }] })
    expect((await result).ok).toBe(true)
    expect(questions.snapshot().questions).toEqual([])
  })

  it('refuses after Cancel with the notice for a folder, and saves nothing', async () => {
    addProfile('personal', 'Personal', folder('personal'))
    const outside = folder('outside', 'notes')
    const { check, answer, store } = setup()
    const result = check({ folder: outside })
    await answer('cancel')
    expect(await result).toEqual({ ok: false, error: { code: 'directory-refused', message: 'Aether did not start the agent in this folder.' } })
    expect(store.isAllowed('personal', 's1', pathKey(outside))).toBe(false)
  })

  it('covers one session with "Allow once", and a new session asks again', async () => {
    addProfile('personal', 'Personal', folder('personal'))
    const outside = folder('outside', 'notes')
    const { check, answer, questions, store } = setup()
    const first = check({ sessionId: 'a', folder: outside })
    await answer('allow-once')
    await first
    expect((await check({ sessionId: 'a', folder: outside })).ok).toBe(true)
    expect(questions.snapshot().questions).toEqual([])
    const second = check({ sessionId: 'b', folder: outside })
    expect(await answer('cancel')).toMatchObject({ kind: 'outside', sessionId: 'b' })
    expect((await second).ok).toBe(false)
    store.forgetSession('a')
    void check({ sessionId: 'a', folder: outside })
    expect(await answer('cancel')).toMatchObject({ sessionId: 'a' })
  })

  it('covers the folder for the profile with "Always allow", for each session, and not for another profile', async () => {
    addProfile('personal', 'Personal', folder('personal'))
    addProfile('client', 'Client Example', folder('client'))
    const outside = folder('outside', 'notes')
    const { check, answer, questions } = setup()
    const first = check({ folder: outside })
    await answer('allow-always')
    await first
    expect((await check({ folder: outside })).ok).toBe(true)
    expect((await check({ folder: join(outside, '..', 'notes') })).ok).toBe(true)
    expect(questions.snapshot().questions).toEqual([])
    void check({ folder: outside, profileId: 'client' })
    expect(await answer('cancel')).toMatchObject({ kind: 'outside', profileName: 'Client Example' })
  })

  it('asks for every folder of a profile without a workspace directory', async () => {
    addProfile('personal', 'Personal', null)
    const { check, answer } = setup()
    void check({ folder: folder('personal', 'repo-a') })
    expect(await answer('cancel')).toMatchObject({ kind: 'outside' })
  })

  it('asks for a sibling of the workspace directory, a ".." path and a junction', async () => {
    const workspace = folder('personal')
    addProfile('personal', 'Personal', workspace)
    const target = folder('elsewhere', 'notes')
    symlinkSync(target, join(workspace, 'linked'), 'junction')
    const { check, answer } = setup()
    for (const path of [folder('personal-backup', 'notes'), join(workspace, '..', 'elsewhere', 'notes'), join(workspace, 'linked')]) {
      void check({ folder: path })
      expect(await answer('cancel')).toMatchObject({ kind: 'outside' })
    }
  })

  it('asks the question for another profile, names both profiles and the Claude folder, and saves "Always allow" for the asking profile', async () => {
    addProfile('personal', 'Personal', folder('personal'), 'C:\\claude\\personal')
    addProfile('client', 'Client Example', folder('client'), 'C:\\claude\\client')
    const contracts = folder('client', 'contracts')
    const { check, answer, store } = setup()
    const result = check({ folder: contracts })
    expect(await answer('allow-always')).toMatchObject({
      kind: 'other-profile',
      profileName: 'Personal',
      otherProfileName: 'Client Example',
      claudeFolder: 'C:\\claude\\personal'
    })
    expect((await result).ok).toBe(true)
    expect(store.isAllowed('personal', 's2', pathKey(contracts))).toBe(true)
    expect(store.isAllowed('client', 's2', pathKey(contracts))).toBe(false)
  })

  it('gives a null Claude folder when no account sets one, and never creates an account', async () => {
    addProfile('personal', 'Personal', folder('personal'))
    addProfile('client', 'Client Example', folder('client'))
    const { check, answer } = setup()
    void check({ folder: folder('client', 'contracts') })
    expect(await answer('cancel')).toMatchObject({ kind: 'other-profile', claudeFolder: null })
    expect(database.prepare('SELECT count(*) AS total FROM providers').get()).toEqual({ total: 0 })
  })

  it('names the Claude folder of the agent run of a session that has one', async () => {
    addProfile('personal', 'Personal', folder('personal'), 'C:\\claude\\current')
    addProfile('client', 'Client Example', folder('client'))
    database
      .prepare("INSERT INTO providers (id, profile_id, kind, label, settings, is_current, created_at) VALUES ('old', 'personal', 'claude-code', 'Old', ?, 0, '2026-01-01')")
      .run(JSON.stringify({ configFolder: 'C:\\claude\\old' }))
    database
      .prepare("INSERT INTO sessions (id, profile_id, provider_id, title, prompt, mode, source_path, model, created_at) VALUES ('run', 'personal', 'old', 't', 'p', 'ask', 'x', 'default', '2026-01-01')")
      .run()
    database.prepare("INSERT INTO agent_sessions (id, session_id, provider_id, external_id, created_at) VALUES ('r1', 'run', 'old', 'x', '2026-01-01')").run()
    const { check, answer } = setup()
    void check({ sessionId: 'run', folder: folder('client', 'contracts') })
    expect(await answer('cancel')).toMatchObject({ claudeFolder: 'C:\\claude\\old' })
  })

  it('treats a UNC folder as outside', async () => {
    addProfile('personal', 'Personal', folder('personal'))
    const { check, answer } = setup()
    void check({ folder: '\\\\aether-no-such-server\\share\\repo' })
    expect(await answer('cancel')).toMatchObject({ kind: 'outside' })
  })
})

describe('checkDirectoryHandler: what makes a plain folder ask (decision 1)', () => {
  // The scanner of Claude Code decides what a file holds (its own test covers it). The gate asks
  // whenever the scan finds any file, hook, server or unreadable file.
  const file = (name: string, keys: string[] = []) => ({ name, keys })
  const found = (part: Partial<ProjectFindings>): ProjectFindings => ({ ...noFindings(), ...part })

  it.each([
    ['settings.local.json with a SessionStart hook', found({ files: [file('.claude/settings.local.json')], hooks: [{ event: 'SessionStart', command: 'node evil.js' }] })],
    ['a UserPromptSubmit hook', found({ files: [file('.claude/settings.json')], hooks: [{ event: 'UserPromptSubmit', command: 'node evil.js' }] })],
    ['a PreToolUse hook', found({ hooks: [{ event: 'PreToolUse', command: 'node evil.js' }] })],
    ['an apiKeyHelper key', found({ files: [file('.claude/settings.json', ['apiKeyHelper'])] })],
    ['an empty settings file', found({ files: [file('.claude/settings.json')] })],
    ['an empty .mcp.json', found({ files: [file('.mcp.json')] })],
    ['a server', found({ mcpServers: [{ name: 'a', command: null }] })],
    ['a file that does not parse', found({ unreadable: ['.claude/settings.local.json'] })]
  ])('asks for trust in a plain folder with %s, and lists it', async (_name, findings) => {
    addProfile('personal', 'Personal', folder('personal'))
    const plain = folder('personal', 'tool')
    findingsOf[pathKey(plain)] = findings
    const { check, answer } = setup()
    void check({ folder: plain })
    expect(await answer('cancel')).toMatchObject({ kind: 'trust', repository: 'tool', ...findings })
  })

  it('asks nothing for a plain folder with no finding', async () => {
    addProfile('personal', 'Personal', folder('personal'))
    const { check, questions } = setup()
    expect((await check({ folder: folder('personal', 'notes') })).ok).toBe(true)
    expect(questions.snapshot().questions).toEqual([])
  })

  it('asks for a Git repository with no finding, and lists nothing', async () => {
    addProfile('personal', 'Personal', folder('personal'))
    const repo = repository('personal', 'repo-a')
    const { check, answer } = setup()
    void check({ folder: repo })
    expect(await answer('cancel')).toMatchObject({ kind: 'trust', hooks: [], mcpServers: [], files: [], unreadable: [] })
  })

  it('lists the files of a repository root and of the session folder inside it, with the path of the folder', async () => {
    addProfile('personal', 'Personal', folder('personal'))
    const repo = repository('personal', 'repo-a')
    const inside = folder('personal', 'repo-a', 'packages', 'app')
    findingsOf[pathKey(repo)] = found({ files: [file('.claude/settings.json')] })
    findingsOf[pathKey(inside)] = found({ files: [file('.claude/settings.local.json')] })
    const { check, answer } = setup()
    void check({ folder: inside })
    expect(await answer('cancel')).toMatchObject({
      files: [{ name: '.claude/settings.json' }, { name: `${join('packages', 'app')}${sep}.claude/settings.local.json` }]
    })
  })
})

describe('checkDirectoryHandler: nested workspace directories (decision 2)', () => {
  it('lets the most specific workspace directory win: a session of A in the directory of B gets the question for another profile', async () => {
    addProfile('personal', 'Personal', folder('x'))
    addProfile('client', 'Client Example', folder('x', 'client'))
    const { check, answer } = setup()
    void check({ folder: folder('x', 'client', 'contracts') })
    expect(await answer('cancel')).toMatchObject({ kind: 'other-profile', profileName: 'Personal', otherProfileName: 'Client Example' })
    // A folder of A outside the directory of B stays inside A.
    expect((await check({ folder: folder('x', 'notes') })).ok).toBe(true)
  })

  it('treats the outer profile as the other one only for a folder of the outer profile, when the inner profile asks', async () => {
    addProfile('personal', 'Personal', folder('x'))
    addProfile('client', 'Client Example', folder('x', 'client'))
    const { check } = setup()
    expect((await check({ profileId: 'client', folder: folder('x', 'client', 'contracts') })).ok).toBe(true)
  })
})

describe('checkDirectoryHandler: a cancel during the scan (F3)', () => {
  /** A scanner that waits for the test, so that a cancel can come while the gate scans. */
  function slowScanner() {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const scanner: ProjectScanner = {
      scan: async () => {
        await gate
        return noFindings()
      }
    }
    return { scanner, release }
  }
  const ticks = async () => {
    for (let wait = 0; wait < 20; wait += 1) await Promise.resolve()
  }

  it.each([
    ['a stop or a delete of the session', (questions: Questions) => questions.cancelSession('s1')],
    ['a quit', (questions: Questions) => questions.cancelAll()]
  ])('opens no question after %s that came during the scan, and refuses', async (_name, cancel) => {
    addProfile('personal', 'Personal', folder('personal'))
    const repo = repository('personal', 'repo-b')
    const { scanner, release } = slowScanner()
    const { check, questions } = setup({ scanner })
    const result = check({ sessionId: 's1', folder: repo })
    await ticks()
    cancel(questions)
    release()
    expect(await result).toMatchObject({ ok: false })
    expect(questions.snapshot().questions).toEqual([])
    expect(questions.snapshot().revision).toBe(0)
  })

  it('opens no directory question after a cancel during the scan, and saves no answer', async () => {
    addProfile('personal', 'Personal', folder('personal'))
    const outside = folder('outside', 'notes')
    const { scanner, release } = slowScanner()
    const { check, questions, store } = setup({ scanner })
    const result = check({ sessionId: 's1', folder: outside })
    await ticks()
    questions.cancelSession('s1')
    release()
    expect(await result).toMatchObject({ ok: false })
    expect(questions.snapshot().questions).toEqual([])
    expect(store.isAllowed('personal', 's1', pathKey(outside))).toBe(false)
  })

  it('still asks when the cancel came for another session, or before the check began', async () => {
    addProfile('personal', 'Personal', folder('personal'))
    const repo = repository('personal', 'repo-b')
    const { scanner, release } = slowScanner()
    const { check, questions, nextQuestion } = setup({ scanner })
    questions.cancelSession('s1')
    questions.cancelAll()
    void check({ sessionId: 's1', folder: repo })
    await ticks()
    questions.cancelSession('other')
    release()
    expect(await nextQuestion()).toMatchObject({ kind: 'trust', sessionId: 's1' })
  })

  it('does not read a network folder before the answer', async () => {
    addProfile('personal', 'Personal', folder('personal'))
    let scans = 0
    const counting: ProjectScanner = {
      scan: async () => {
        scans += 1
        return noFindings()
      }
    }
    const { check, answer } = setup({ scanner: counting })
    void check({ folder: '\\\\aether-no-such-server\\share\\repo' })
    expect(await answer('cancel')).toMatchObject({ kind: 'outside', unreadable: ['this network folder'] })
    expect(scans).toBe(0)
  })
})

describe('checkDirectoryHandler: the repository root in the trust question (S5)', () => {
  it('names the repository root, and holds no workspace directory when the repository lies inside it (S5-14)', async () => {
    const workspace = folder('personal')
    addProfile('personal', 'Personal', workspace)
    const repo = repository('personal', 'repo-b')
    const { check, answer } = setup()
    const result = check({ folder: folder('personal', 'repo-b', 'app') })
    expect(await answer('cancel')).toMatchObject({ kind: 'trust', repository: 'repo-b', repositoryRoot: repo, holdsWorkspace: false, workspaceDirectory: workspace })
    expect((await result).ok).toBe(false)
  })

  it('holds the workspace directory when the repository root is above it, as a dotfiles repository in the home folder (S5-13)', async () => {
    const workspace = folder('home', 'directories')
    addProfile('personal', 'Personal', workspace)
    const root = repository('home')
    const { check, answer } = setup()
    void check({ folder: folder('home', 'directories', 'repo-a') })
    expect(await answer('cancel')).toMatchObject({ kind: 'trust', repository: 'home', repositoryRoot: root, holdsWorkspace: true, workspaceDirectory: workspace })
  })

  it('holds the workspace directory when the repository root is that directory (S5-13)', async () => {
    const workspace = repository('personal')
    addProfile('personal', 'Personal', workspace)
    const { check, answer } = setup()
    void check({ folder: folder('personal', 'repo-a') })
    expect(await answer('cancel')).toMatchObject({ kind: 'trust', repositoryRoot: workspace, holdsWorkspace: true })
  })

  it('names no repository root for a plain folder that asks because of its settings files', async () => {
    const workspace = folder('personal')
    addProfile('personal', 'Personal', workspace)
    const notes = folder('personal', 'notes')
    findingsOf[pathKey(notes)] = hook()
    const { check, answer } = setup()
    void check({ folder: notes })
    expect(await answer('cancel')).toMatchObject({ kind: 'trust', repository: 'notes', repositoryRoot: null, holdsWorkspace: false })
  })
})
