// Tests of the test lock (S6): scripts/check-lock.mjs runs on small git repositories that
// each test builds in a temporary folder. The repositories hold test data only. Each one sets
// `commit.gpgsign=false` in its own config. The config of this repository stays as it is.
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Each test starts a dozen git processes. A slow runner needs more than the default 5 seconds.
vi.setConfig({ testTimeout: 60_000 })

const SCRIPT = fileURLToPath(new URL('../../scripts/check-lock.mjs', import.meta.url))

const TEST_FILE = 'tests/acceptance/m0-gates/x/a.spec.ts'
const OTHER_TEST = 'tests/acceptance/m0-gates/x/b.spec.ts'
const SIMULATED = 'tests/simulated-agent/agent.mjs'
// A story PR targets a milestone branch. The lock check walks the commits of such a PR only.
const BASE = 'milestone/m0-gates'
const RULE = 'eslint(no-restricted-globals)'

/** The rule of the lock: SHA-256 of the file with CRLF turned into LF. */
const sha = (text: string) =>
  createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex')

/** The content of tests/locks.json for files with their content. */
const locks = (files: Record<string, string>, story = 'm0-gates/x') =>
  `${JSON.stringify(
    Object.fromEntries(Object.entries(files).map(([path, text]) => [path, { sha256: sha(text), story }])),
    null,
    2
  )}\n`

const known = (...entries: [string, string, number][]) =>
  `${JSON.stringify(entries.map(([rule, file, count]) => ({ rule, file, count })), null, 2)}\n`

const repos: Repo[] = []

class Repo {
  readonly dir = mkdtempSync(join(tmpdir(), 'aether-lock-'))

  constructor(branch = BASE) {
    repos.push(this)
    this.git('init', '-q', '-b', branch)
    this.git('config', 'user.name', 'Lock Test')
    this.git('config', 'user.email', 'lock-test@example.invalid')
    this.git('config', 'commit.gpgsign', 'false')
    this.git('config', 'core.autocrlf', 'false')
  }

  git(...args: string[]) {
    return execFileSync('git', args, { cwd: this.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  }

  write(files: Record<string, string | null>) {
    for (const [path, text] of Object.entries(files)) {
      const full = join(this.dir, path)
      if (text === null) {
        rmSync(full, { force: true })
        continue
      }
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, text)
    }
  }

  /** One commit with the given files (null deletes one). `reason` adds the trailer. */
  commit(message: string, files: Record<string, string | null> = {}, reason?: string) {
    this.write(files)
    this.git('add', '-A')
    const args = ['commit', '-q', '--allow-empty', '-m', message]
    if (reason !== undefined) args.push('-m', `Locked-Test-Change: ${reason}`)
    this.git(...args)
  }

  /** A merge of `branch` into the current branch. `files` is an edit inside the merge commit. */
  merge(branch: string, files: Record<string, string | null> = {}) {
    try {
      this.git('merge', '-q', '--no-ff', '--no-commit', branch)
    } catch {
      // A conflict. `files` holds the resolution.
    }
    this.write(files)
    this.git('add', '-A')
    this.git('commit', '-q', '-m', `Merge ${branch}`)
  }

  switch(branch: string, create = false) {
    this.git('checkout', '-q', ...(create ? ['-b'] : []), branch)
  }

  /**
   * A commit of files that never exist in the working tree. The file system of Windows holds one
   * of two names that differ only in case, so the test writes the objects and the index itself.
   */
  commitBlobs(message: string, files: Record<string, string>) {
    for (const [path, text] of Object.entries(files)) {
      const id = execFileSync('git', ['hash-object', '-w', '--stdin'], {
        cwd: this.dir,
        input: text,
        encoding: 'utf8'
      }).trim()
      this.git('update-index', '--add', '--cacheinfo', `100644,${id},${path}`)
    }
    this.git('commit', '-q', '-m', message)
  }

  /** Makes `origin/<branch>` point at the branch, as a clone of the repository would. */
  publish(branch: string) {
    this.git('update-ref', `refs/remotes/origin/${branch}`, branch)
  }

  /** Runs the check. `base` set means a PR check. Without it, the check is the one of a push. */
  check(base?: string, extra: string[] = []) {
    const args = [SCRIPT, '--repo', this.dir, ...(base ? ['--base', base] : []), ...extra]
    const run = spawnSync(process.execPath, args, { encoding: 'utf8' })
    return { status: run.status, out: run.stdout, err: run.stderr, all: `${run.stdout}${run.stderr}` }
  }
}

afterEach(() => {
  for (const repo of repos.splice(0)) {
    rmSync(repo.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

/** A repository on `main` with the base files, and a branch `story` checked out. */
function storyRepo(base: Record<string, string> = { 'README.md': 'base\n' }) {
  const repo = new Repo()
  repo.commit('Base', base)
  repo.switch('story', true)
  return repo
}

const SPEC_V1 = "test('a', () => {})\n"
const SPEC_V2 = "test('a changed', () => {})\n"

describe('G13: a story with the tests first and the code second', () => {
  it('passes when commit 1 adds a locked test and commit 2 adds code', () => {
    const repo = storyRepo()
    repo.commit('Add the locked test', { [TEST_FILE]: SPEC_V1, 'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1 }) })
    repo.commit('Add the code', { 'src/code.ts': 'export const a = 1\n' })
    const result = repo.check(BASE)
    expect(result.all).toContain('lock: passed')
    expect(result.status).toBe(0)
  })

  it('lets the test author change the new test before the first code commit', () => {
    const repo = storyRepo()
    repo.commit('Add the locked test', { [TEST_FILE]: SPEC_V1, 'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1 }) })
    repo.commit('Change the test', { [TEST_FILE]: SPEC_V2, 'tests/locks.json': locks({ [TEST_FILE]: SPEC_V2 }) })
    repo.commit('Add more tests', { [OTHER_TEST]: SPEC_V1, 'tests/locks.json': locks({ [TEST_FILE]: SPEC_V2, [OTHER_TEST]: SPEC_V1 }) })
    repo.commit('Add the code', { 'src/code.ts': 'export const a = 1\n' })
    expect(repo.check(BASE).status).toBe(0)
  })

  it('passes a story with code commits only, when it locks nothing', () => {
    const repo = storyRepo()
    repo.commit('Add the code', { 'src/code.ts': 'export const a = 1\n' })
    repo.commit('Add a unit test', { 'tests/architecture/unit.test.ts': 'x\n' })
    expect(repo.check(BASE).status).toBe(0)
  })

  it('treats a change of a file outside tests as the first code commit, whatever the file is', () => {
    const repo = storyRepo()
    repo.commit('Add a script', { 'scripts/tool.mjs': 'x\n' })
    repo.commit('Add the locked test', { [TEST_FILE]: SPEC_V1, 'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1 }) })
    const result = repo.check(BASE)
    expect(result.status).toBe(1)
    expect(result.all).toContain(`Locked test changed: \`${TEST_FILE}\``)
  })
})

describe('G14: no change of a locked test after the first code commit', () => {
  function afterCode() {
    const repo = storyRepo()
    repo.commit('Add the locked test', { [TEST_FILE]: SPEC_V1, 'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1 }) })
    repo.commit('Add the code', { 'src/code.ts': 'export const a = 1\n' })
    return repo
  }

  it('fails and names the file when a later commit changes the test and its hash', () => {
    const repo = afterCode()
    repo.commit('Weaken the test', { [TEST_FILE]: SPEC_V2, 'tests/locks.json': locks({ [TEST_FILE]: SPEC_V2 }) })
    const result = repo.check(BASE)
    expect(result.all).toContain(`Locked test changed: \`${TEST_FILE}\``)
    expect(result.status).toBe(1)
  })

  it('fails when a later commit changes only the test', () => {
    const repo = afterCode()
    repo.commit('Weaken the test', { [TEST_FILE]: SPEC_V2 })
    const result = repo.check(BASE)
    expect(result.all).toContain(`Locked test changed: \`${TEST_FILE}\``)
    expect(result.status).toBe(1)
  })

  it('fails when a later commit changes only the hash in tests/locks.json', () => {
    const repo = afterCode()
    repo.commit('Change the entry', { 'tests/locks.json': locks({ [TEST_FILE]: SPEC_V2 }) })
    const result = repo.check(BASE)
    expect(result.all).toContain(`Locked test changed: \`${TEST_FILE}\``)
    expect(result.status).toBe(1)
  })

  it('fails when a later commit deletes the test', () => {
    const repo = afterCode()
    repo.commit('Delete the test', { [TEST_FILE]: null })
    const result = repo.check(BASE)
    expect(result.all).toContain(`Locked test changed: \`${TEST_FILE}\``)
    expect(result.status).toBe(1)
  })

  it('fails when a later commit removes the entry', () => {
    const repo = afterCode()
    repo.commit('Drop the entry', { 'tests/locks.json': '{}\n' })
    const result = repo.check(BASE)
    expect(result.all).toContain(`Locked test changed: \`${TEST_FILE}\``)
    expect(result.status).toBe(1)
  })

  it('fails when a later commit locks a new file', () => {
    const repo = afterCode()
    repo.commit('Lock another test', {
      [OTHER_TEST]: SPEC_V1,
      'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1, [OTHER_TEST]: SPEC_V1 })
    })
    const result = repo.check(BASE)
    expect(result.all).toContain(`Locked test changed: \`${OTHER_TEST}\``)
    expect(result.status).toBe(1)
  })

  it('fails when the first code commit also changes a locked test', () => {
    const repo = storyRepo()
    repo.commit('Add the locked test', { [TEST_FILE]: SPEC_V1, 'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1 }) })
    repo.commit('Code and test together', {
      'src/code.ts': 'export const a = 1\n',
      [TEST_FILE]: SPEC_V2,
      'tests/locks.json': locks({ [TEST_FILE]: SPEC_V2 })
    })
    const result = repo.check(BASE)
    expect(result.all).toContain(`Locked test changed: \`${TEST_FILE}\``)
    expect(result.status).toBe(1)
  })

  it('passes a later change of a test that the story added, with the trailer, and prints the reason', () => {
    const repo = afterCode()
    repo.commit(
      'Fix the test',
      { [TEST_FILE]: SPEC_V2, 'tests/locks.json': locks({ [TEST_FILE]: SPEC_V2 }) },
      'The coordinator approved a wrong selector fix'
    )
    const result = repo.check(BASE)
    expect(result.out).toContain(TEST_FILE)
    expect(result.out).toContain('The coordinator approved a wrong selector fix')
    expect(result.status).toBe(0)
  })

  it('lets a later commit change tests that are not locked', () => {
    const repo = afterCode()
    repo.commit('A unit test', { 'tests/architecture/unit.test.ts': 'x\n' })
    expect(repo.check(BASE).status).toBe(0)
  })
})

describe('G15: a test locked on the base branch', () => {
  const baseFiles = () => ({
    'README.md': 'base\n',
    [TEST_FILE]: SPEC_V1,
    [SIMULATED]: 'agent\n',
    'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1, [SIMULATED]: 'agent\n' })
  })

  it('fails without the trailer and names the file', () => {
    const repo = storyRepo(baseFiles())
    repo.commit('Change the locked test', {
      [TEST_FILE]: SPEC_V2,
      'tests/locks.json': locks({ [TEST_FILE]: SPEC_V2, [SIMULATED]: 'agent\n' })
    })
    const result = repo.check(BASE)
    expect(result.all).toContain(`Locked test changed: \`${TEST_FILE}\``)
    expect(result.status).toBe(1)
  })

  it('passes with the trailer and prints the reason', () => {
    const repo = storyRepo(baseFiles())
    repo.commit(
      'Change the locked test',
      { [TEST_FILE]: SPEC_V2, 'tests/locks.json': locks({ [TEST_FILE]: SPEC_V2, [SIMULATED]: 'agent\n' }) },
      'The brief changed the label'
    )
    const result = repo.check(BASE)
    expect(result.out).toContain(TEST_FILE)
    expect(result.out).toContain('The brief changed the label')
    expect(result.status).toBe(0)
  })

  it('needs the trailer after the first code commit too, and passes with it', () => {
    const repo = storyRepo(baseFiles())
    repo.commit('Add the code', { 'src/code.ts': 'export const a = 1\n' })
    const files = { [TEST_FILE]: SPEC_V2, 'tests/locks.json': locks({ [TEST_FILE]: SPEC_V2, [SIMULATED]: 'agent\n' }) }
    repo.commit('Change the locked test', files)
    expect(repo.check(BASE).status).toBe(1)
    repo.git('reset', '-q', '--hard', 'HEAD~1')
    repo.commit('Change the locked test', files, 'Approved by the coordinator')
    const result = repo.check(BASE)
    expect(result.out).toContain('Approved by the coordinator')
    expect(result.status).toBe(0)
  })

  it('fails on a change of the file in a commit that has the trailer without a reason', () => {
    const repo = storyRepo(baseFiles())
    repo.commit(
      'Change the locked test',
      { [TEST_FILE]: SPEC_V2, 'tests/locks.json': locks({ [TEST_FILE]: SPEC_V2, [SIMULATED]: 'agent\n' }) },
      ''
    )
    const result = repo.check(BASE)
    expect(result.all).toContain(`Locked test changed: \`${TEST_FILE}\``)
    expect(result.status).toBe(1)
  })

  it('fails when a commit removes the entry of a base file without the trailer', () => {
    const repo = storyRepo(baseFiles())
    repo.commit('Drop the entry', { 'tests/locks.json': locks({ [SIMULATED]: 'agent\n' }) })
    const result = repo.check(BASE)
    expect(result.all).toContain(`Locked test changed: \`${TEST_FILE}\``)
    expect(result.status).toBe(1)
  })

  it('fails on a change of the entry alone, and keeps the other files out of the message', () => {
    const repo = storyRepo(baseFiles())
    repo.commit('Change the entry', { 'tests/locks.json': locks({ [TEST_FILE]: SPEC_V2, [SIMULATED]: 'agent\n' }) })
    const result = repo.check(BASE)
    expect(result.all).toContain(`Locked test changed: \`${TEST_FILE}\``)
    expect(result.all).not.toContain(`Locked test changed: \`${SIMULATED}\``)
    expect(result.status).toBe(1)
  })

  it('leaves the other locked files free to stay', () => {
    const repo = storyRepo(baseFiles())
    repo.commit('Add the code', { 'src/code.ts': 'export const a = 1\n' })
    expect(repo.check(BASE).status).toBe(0)
  })
})

describe('known violations', () => {
  const list = known([RULE, 'src/a.tsx', 2])
  const base = () => ({ 'README.md': 'base\n', 'tests/architecture/known-violations.json': list })

  it('fails when the story adds an entry', () => {
    const repo = storyRepo(base())
    repo.commit('Add an entry', {
      'tests/architecture/known-violations.json': known([RULE, 'src/a.tsx', 2], [RULE, 'src/b.tsx', 1])
    })
    const result = repo.check(BASE)
    expect(result.all).toContain(`Known violations grew: \`${RULE}\` in \`src/b.tsx\``)
    expect(result.status).toBe(1)
  })

  it('fails when the story raises a count', () => {
    const repo = storyRepo(base())
    repo.commit('Raise the count', { 'tests/architecture/known-violations.json': known([RULE, 'src/a.tsx', 3]) })
    const result = repo.check(BASE)
    expect(result.all).toContain(`Known violations grew: \`${RULE}\` in \`src/a.tsx\``)
    expect(result.status).toBe(1)
  })

  it('fails when the story raises a count after the first code commit, then lowers it again', () => {
    const repo = storyRepo(base())
    repo.commit('Add the code', { 'src/code.ts': 'export const a = 1\n' })
    repo.commit('Raise the count', { 'tests/architecture/known-violations.json': known([RULE, 'src/a.tsx', 3]) })
    repo.commit('Lower the count', { 'tests/architecture/known-violations.json': known([RULE, 'src/a.tsx', 2]) })
    const result = repo.check(BASE)
    expect(result.all).toContain(`Known violations grew: \`${RULE}\` in \`src/a.tsx\``)
    expect(result.status).toBe(1)
  })

  it('fails when a test-only commit before the first code commit adds an entry', () => {
    const repo = storyRepo(base())
    repo.commit('Add an entry with the tests', {
      'tests/architecture/known-violations.json': known([RULE, 'src/a.tsx', 2], [RULE, 'src/c.tsx', 1])
    })
    repo.commit('Add the code', { 'src/code.ts': 'export const a = 1\n' })
    const result = repo.check(BASE)
    expect(result.all).toContain(`Known violations grew: \`${RULE}\` in \`src/c.tsx\``)
    expect(result.status).toBe(1)
  })

  it('passes when the story lowers a count or removes an entry', () => {
    const repo = storyRepo({
      'README.md': 'base\n',
      'tests/architecture/known-violations.json': known([RULE, 'src/a.tsx', 2], [RULE, 'src/b.tsx', 1])
    })
    repo.commit('Fix a violation', {
      'src/a.tsx': 'x\n',
      'tests/architecture/known-violations.json': known([RULE, 'src/a.tsx', 1])
    })
    expect(repo.check(BASE).status).toBe(0)
  })

  it('passes when the base branch has no list yet, because the story creates it', () => {
    const repo = storyRepo()
    repo.commit('Create the list', { 'tests/architecture/known-violations.json': list })
    expect(repo.check(BASE).status).toBe(0)
  })

  it('compares with the fork point, so a count that the base branch lowered later is no growth', () => {
    const repo = storyRepo(base())
    repo.commit('Add the code', { 'src/code.ts': 'export const a = 1\n' })
    repo.switch(BASE)
    repo.commit('Lower the count', { 'tests/architecture/known-violations.json': known([RULE, 'src/a.tsx', 1]) })
    repo.switch('story')
    const result = repo.check(BASE)
    expect(result.all).toContain('lock: passed')
    expect(result.status).toBe(0)
  })
})

describe('hashes', () => {
  it('fails on a stale hash and names the file', () => {
    const repo = storyRepo()
    repo.commit('Add the locked test', { [TEST_FILE]: SPEC_V1, 'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1 }) })
    repo.commit('Change the test, keep the hash', { [TEST_FILE]: SPEC_V2 })
    const result = repo.check(BASE)
    expect(result.all).toContain(`Locked test changed: \`${TEST_FILE}\``)
    expect(result.status).toBe(1)
  })

  it('fails on a stale hash in a trailer commit that keeps the old hash', () => {
    const repo = storyRepo({
      'README.md': 'base\n',
      [TEST_FILE]: SPEC_V1,
      'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1 })
    })
    repo.commit('Change the test', { [TEST_FILE]: SPEC_V2 }, 'A reason')
    const result = repo.check(BASE)
    expect(result.all).toContain(`Locked test changed: \`${TEST_FILE}\``)
    expect(result.all).toContain('hash')
    expect(result.status).toBe(1)
  })

  it('fails when a locked file is missing at the head, even with the trailer', () => {
    const repo = storyRepo({
      'README.md': 'base\n',
      [TEST_FILE]: SPEC_V1,
      'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1 })
    })
    repo.commit('Delete the test', { [TEST_FILE]: null }, 'A reason')
    const result = repo.check(BASE)
    expect(result.all).toContain(`Locked test changed: \`${TEST_FILE}\``)
    expect(result.status).toBe(1)
  })

  it('passes a retired test when the commit removes the file and the entry, with the trailer', () => {
    const repo = storyRepo({
      'README.md': 'base\n',
      [TEST_FILE]: SPEC_V1,
      'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1 })
    })
    repo.commit('Retire the test', { [TEST_FILE]: null, 'tests/locks.json': '{}\n' }, 'The story removes work items')
    const result = repo.check(BASE)
    expect(result.out).toContain('The story removes work items')
    expect(result.status).toBe(0)
  })

  it('fails when a test under tests/acceptance has no entry', () => {
    const repo = storyRepo()
    repo.commit('Add a test and no entry', { [TEST_FILE]: SPEC_V1 })
    const result = repo.check(BASE)
    expect(result.all).toContain(`Locked test changed: \`${TEST_FILE}\``)
    expect(result.status).toBe(1)
  })

  it('fails when a file under tests/simulated-agent has no entry', () => {
    const repo = storyRepo()
    repo.commit('Add a file and no entry', { 'tests/simulated-agent/new.mjs': 'x\n' })
    const result = repo.check(BASE)
    expect(result.all).toContain('Locked test changed: `tests/simulated-agent/new.mjs`')
    expect(result.status).toBe(1)
  })

  it('fails when tests/locks.json is not valid JSON', () => {
    const repo = storyRepo()
    repo.commit('Break the lock file', { 'tests/locks.json': '{ nope' })
    const result = repo.check(BASE)
    expect(result.all).toContain('tests/locks.json')
    expect(result.status).toBe(1)
  })

  it('hashes a file with CRLF line endings as the same file with LF', () => {
    const repo = storyRepo()
    const crlf = "test('a', () => {})\r\ntest('b', () => {})\r\n"
    const lf = crlf.replaceAll('\r\n', '\n')
    repo.commit('Add the test with CRLF', { [TEST_FILE]: crlf, 'tests/locks.json': locks({ [TEST_FILE]: lf }) })
    repo.commit('Add the code', { 'src/code.ts': 'export const a = 1\n' })
    const result = repo.check(BASE)
    expect(result.all).toContain('lock: passed')
    expect(result.status).toBe(0)
  })

  it('still fails when the CRLF file differs in more than its line endings', () => {
    const repo = storyRepo()
    repo.commit('Add the test', {
      [TEST_FILE]: "test('a', () => {})\r\n",
      'tests/locks.json': locks({ [TEST_FILE]: "test('b', () => {})\n" })
    })
    expect(repo.check(BASE).status).toBe(1)
  })
})

describe('merge commits in a story', () => {
  /** The base branch moves: new code, a changed base-locked test with its new hash, a new known violation. */
  function movedBase() {
    const repo = new Repo()
    repo.commit('Base', {
      'README.md': 'base\n',
      [TEST_FILE]: SPEC_V1,
      'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1 }),
      'tests/architecture/known-violations.json': known([RULE, 'src/a.tsx', 2])
    })
    repo.switch('story', true)
    repo.switch(BASE)
    repo.commit('Another story merged', {
      'src/other.ts': 'export const b = 2\n',
      [TEST_FILE]: SPEC_V2,
      [OTHER_TEST]: SPEC_V1,
      'tests/locks.json': locks({ [TEST_FILE]: SPEC_V2, [OTHER_TEST]: SPEC_V1 }),
      'tests/architecture/known-violations.json': known([RULE, 'src/a.tsx', 1])
    })
    repo.switch('story')
    return repo
  }

  it('does not count the changes that arrive from the base branch', () => {
    const repo = movedBase()
    repo.commit('Add the locked test', {
      [SIMULATED]: 'agent\n',
      'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1, [SIMULATED]: 'agent\n' })
    })
    repo.merge(BASE, {
      'tests/locks.json': locks({ [TEST_FILE]: SPEC_V2, [OTHER_TEST]: SPEC_V1, [SIMULATED]: 'agent\n' })
    })
    repo.commit('Add the code', { 'src/code.ts': 'export const a = 1\n' })
    const result = repo.check(BASE)
    expect(result.all).not.toContain('Locked test changed')
    expect(result.status).toBe(0)
  })

  it('does not take a merge from the base branch as the first code commit', () => {
    const repo = storyRepo({ 'README.md': 'base\n' })
    repo.switch(BASE)
    repo.commit('Another story merged', { 'src/other.ts': 'export const b = 2\n' })
    repo.switch('story')
    repo.commit('Add a locked test', { [TEST_FILE]: SPEC_V1, 'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1 }) })
    repo.merge(BASE)
    repo.commit('Add a second locked test', {
      [OTHER_TEST]: SPEC_V1,
      'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1, [OTHER_TEST]: SPEC_V1 })
    })
    repo.commit('Add the code', { 'src/code.ts': 'export const a = 1\n' })
    const result = repo.check(BASE)
    expect(result.all).toContain('lock: passed')
    expect(result.status).toBe(0)
  })

  it('does not count a base-locked test that changed on the base branch, with no trailer', () => {
    const repo = movedBase()
    repo.commit('Add the code', { 'src/code.ts': 'export const a = 1\n' })
    repo.merge(BASE)
    const result = repo.check(BASE)
    expect(result.all).toContain('lock: passed')
    expect(result.status).toBe(0)
  })

  it('passes the merge that GitHub checks out: the base branch first, the story second', () => {
    const repo = storyRepo()
    repo.commit('Add the locked test', { [TEST_FILE]: SPEC_V1, 'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1 }) })
    repo.commit('Add the code', { 'src/code.ts': 'export const a = 1\n' })
    repo.switch(BASE)
    repo.commit('Another story merged', { 'src/other.ts': 'export const b = 2\n' })
    repo.switch('synthetic', true)
    repo.git('merge', '-q', '--no-ff', '-m', 'Merge of the pull request', 'story')
    const result = repo.check(BASE)
    expect(result.all).toContain('lock: passed')
    expect(result.status).toBe(0)
  })

  it('counts a change that only the merge commit makes to a locked test', () => {
    const repo = movedBase()
    repo.commit('Add a locked test', {
      [SIMULATED]: 'agent\n',
      'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1, [SIMULATED]: 'agent\n' })
    })
    repo.commit('Add the code', { 'src/code.ts': 'export const a = 1\n' })
    repo.merge(BASE, {
      [SIMULATED]: 'agent changed in the merge\n',
      'tests/locks.json': locks({ [TEST_FILE]: SPEC_V2, [OTHER_TEST]: SPEC_V1, [SIMULATED]: 'agent changed in the merge\n' })
    })
    const result = repo.check(BASE)
    expect(result.all).toContain(`Locked test changed: \`${SIMULATED}\``)
    expect(result.status).toBe(1)
  })

  it('still counts the commits of the story that come before the merge', () => {
    const repo = movedBase()
    repo.commit('Add the code', { 'src/code.ts': 'export const a = 1\n' })
    repo.commit('Change a base test', {
      [TEST_FILE]: SPEC_V1 + '// edit\n',
      'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1 + '// edit\n' })
    })
    repo.merge(BASE, {
      [TEST_FILE]: SPEC_V2,
      'tests/locks.json': locks({ [TEST_FILE]: SPEC_V2, [OTHER_TEST]: SPEC_V1 })
    })
    const result = repo.check(BASE)
    expect(result.all).toContain(`Locked test changed: \`${TEST_FILE}\``)
    expect(result.status).toBe(1)
  })
})

describe('a push with no pull request', () => {
  const list = known([RULE, 'src/a.tsx', 2])

  it('passes when the hashes match and the list did not grow', () => {
    const repo = new Repo()
    repo.commit('Base', {
      [TEST_FILE]: SPEC_V1,
      'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1 }),
      'tests/architecture/known-violations.json': list
    })
    repo.commit('Next', { 'src/code.ts': 'x\n', 'tests/architecture/known-violations.json': known([RULE, 'src/a.tsx', 1]) })
    const result = repo.check()
    expect(result.all).toContain('lock: passed')
    expect(result.status).toBe(0)
  })

  it('passes a change of a locked test with its new hash, because the pull request checked it', () => {
    const repo = new Repo()
    repo.commit('Base', { [TEST_FILE]: SPEC_V1, 'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1 }) })
    repo.commit('Next', { [TEST_FILE]: SPEC_V2, 'tests/locks.json': locks({ [TEST_FILE]: SPEC_V2 }) })
    expect(repo.check().status).toBe(0)
  })

  it('fails on a stale hash', () => {
    const repo = new Repo()
    repo.commit('Base', { [TEST_FILE]: SPEC_V1, 'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1 }) })
    repo.commit('Next', { [TEST_FILE]: SPEC_V2 })
    const result = repo.check()
    expect(result.all).toContain(`Locked test changed: \`${TEST_FILE}\``)
    expect(result.status).toBe(1)
  })

  it('fails when the list grew against the previous commit', () => {
    const repo = new Repo()
    repo.commit('Base', { 'tests/architecture/known-violations.json': list })
    repo.commit('Next', { 'tests/architecture/known-violations.json': known([RULE, 'src/a.tsx', 3]) })
    const result = repo.check()
    expect(result.all).toContain(`Known violations grew: \`${RULE}\` in \`src/a.tsx\``)
    expect(result.status).toBe(1)
  })

  it('checks a merge commit against its first parent', () => {
    const repo = new Repo()
    repo.commit('Base', { 'tests/architecture/known-violations.json': list })
    repo.switch('milestone', true)
    repo.commit('Grow', { 'tests/architecture/known-violations.json': known([RULE, 'src/a.tsx', 2], [RULE, 'src/z.tsx', 1]) })
    repo.switch(BASE)
    repo.git('merge', '-q', '--no-ff', '-m', 'Merge the milestone', 'milestone')
    const result = repo.check()
    expect(result.all).toContain(`Known violations grew: \`${RULE}\` in \`src/z.tsx\``)
    expect(result.status).toBe(1)
  })

  it('passes the first commit that creates the list, and a root commit', () => {
    const repo = new Repo()
    repo.commit('Root', { 'README.md': 'x\n' })
    expect(repo.check().status).toBe(0)
    repo.commit('Create the list', { 'tests/architecture/known-violations.json': list })
    expect(repo.check().status).toBe(0)
  })
})

describe('F1: a milestone PR to main holds squashed stories', () => {
  /** Each story is one squash commit with its tests, its code and its entries. */
  function milestoneRepo() {
    const repo = new Repo('main')
    repo.commit('Base', {
      'README.md': 'base\n',
      'tests/architecture/known-violations.json': known([RULE, 'src/a.tsx', 2])
    })
    repo.switch(BASE, true)
    repo.commit('S5 App test (#5)', {
      [TEST_FILE]: SPEC_V1,
      'src/code.ts': 'export const a = 1\n',
      'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1 })
    })
    repo.commit('S6 Test lock (#6)', {
      [OTHER_TEST]: SPEC_V1,
      'scripts/tool.mjs': 'x\n',
      'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1, [OTHER_TEST]: SPEC_V1 })
    })
    repo.publish('main')
    return repo
  }

  it('passes with the entries that the squash commits add after their code', () => {
    const result = milestoneRepo().check('origin/main')
    expect(result.all).toContain('lock: passed')
    expect(result.all).not.toContain('Locked test changed')
    expect(result.status).toBe(0)
  })

  it('passes when the base is the local branch main', () => {
    expect(milestoneRepo().check('main').status).toBe(0)
  })

  it('asks for no trailer on a test that main locks and a squash commit changes', () => {
    const repo = new Repo('main')
    repo.commit('Base', { [TEST_FILE]: SPEC_V1, 'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1 }) })
    repo.switch(BASE, true)
    repo.commit('S7 (#7)', {
      [TEST_FILE]: SPEC_V2,
      'src/code.ts': 'export const a = 1\n',
      'tests/locks.json': locks({ [TEST_FILE]: SPEC_V2 })
    })
    repo.publish('main')
    expect(repo.check('origin/main').status).toBe(0)
  })

  it('still fails on a stale hash', () => {
    const repo = milestoneRepo()
    repo.commit('Change a test, keep the hash', { [TEST_FILE]: SPEC_V2 })
    const result = repo.check('origin/main')
    expect(result.all).toContain(`Locked test changed: \`${TEST_FILE}\``)
    expect(result.status).toBe(1)
  })

  it('still fails when the known violations grew against main', () => {
    const repo = milestoneRepo()
    repo.commit('Raise a count', { 'tests/architecture/known-violations.json': known([RULE, 'src/a.tsx', 3]) })
    const result = repo.check('origin/main')
    expect(result.all).toContain(`Known violations grew: \`${RULE}\` in \`src/a.tsx\``)
    expect(result.status).toBe(1)
  })

  it('walks the commits when the base is a milestone branch, with the origin prefix', () => {
    const repo = storyRepo()
    repo.publish(BASE)
    repo.commit('Add the locked test', { [TEST_FILE]: SPEC_V1, 'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1 }) })
    repo.commit('Add the code', { 'src/code.ts': 'export const a = 1\n' })
    repo.commit('Weaken the test', { [TEST_FILE]: SPEC_V2, 'tests/locks.json': locks({ [TEST_FILE]: SPEC_V2 }) })
    const result = repo.check(`origin/${BASE}`)
    expect(result.all).toContain(`Locked test changed: \`${TEST_FILE}\``)
    expect(result.status).toBe(1)
  })
})

describe('F2: the job runs a copy of the script from the base branch', () => {
  it('runs from another folder and judges the repository it is given', () => {
    const folder = mkdtempSync(join(tmpdir(), 'aether-lock-copy-'))
    try {
      const copy = join(folder, 'check-lock.mjs')
      copyFileSync(SCRIPT, copy)
      const repo = storyRepo()
      repo.commit('Add the locked test', { [TEST_FILE]: SPEC_V1, 'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1 }) })
      repo.commit('Add the code', { 'src/code.ts': 'export const a = 1\n' })
      const args = [copy, '--repo', repo.dir, '--base', BASE]
      const pass = spawnSync(process.execPath, args, { encoding: 'utf8' })
      expect(pass.stdout).toContain('lock: passed')
      repo.commit('Weaken the test', { [TEST_FILE]: SPEC_V2, 'tests/locks.json': locks({ [TEST_FILE]: SPEC_V2 }) })
      const fail = spawnSync(process.execPath, args, { encoding: 'utf8' })
      expect(fail.stderr).toContain(`Locked test changed: \`${TEST_FILE}\``)
      expect(fail.status).toBe(1)
    } finally {
      rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  })

  it('imports nothing but Node modules, so a copy needs no node_modules', () => {
    const source = readFileSync(SCRIPT, 'utf8')
    const specifiers = [...source.matchAll(/^import .* from '([^']+)'/gm)].map((match) => match[1])
    expect(specifiers.length).toBeGreaterThan(0)
    for (const specifier of specifiers) expect(specifier).toMatch(/^node:/)
  })
})

describe('case collisions under the locked folders', () => {
  it('fails on two head paths that differ only in case, and names both', () => {
    const repo = storyRepo()
    const upper = 'tests/acceptance/m0-gates/x/App.spec.ts'
    const lower = 'tests/acceptance/m0-gates/x/app.spec.ts'
    repo.commitBlobs('Add two tests that differ in case', {
      [upper]: SPEC_V1,
      [lower]: SPEC_V2,
      'tests/locks.json': locks({ [upper]: SPEC_V1, [lower]: SPEC_V2 })
    })
    const result = repo.check(BASE)
    expect(result.all).toContain(upper)
    expect(result.all).toContain(lower)
    expect(result.all).toMatch(/case/i)
    expect(result.status).toBe(1)
  })

  it('passes two different names', () => {
    const repo = storyRepo()
    repo.commit('Add two tests', {
      [TEST_FILE]: SPEC_V1,
      [OTHER_TEST]: SPEC_V2,
      'tests/locks.json': locks({ [TEST_FILE]: SPEC_V1, [OTHER_TEST]: SPEC_V2 })
    })
    expect(repo.check(BASE).status).toBe(0)
  })
})

describe('the command', () => {
  it('fails with a clear message when the base reference does not exist', () => {
    const repo = storyRepo()
    const result = repo.check('origin/nothing')
    expect(result.all).toContain('origin/nothing')
    expect(result.status).toBe(1)
  })

  it('adds entries from the files, with the story and the normalized hash', () => {
    const repo = storyRepo()
    repo.write({ [TEST_FILE]: "test('a', () => {})\r\n", [OTHER_TEST]: SPEC_V1 })
    const run = spawnSync(
      process.execPath,
      [SCRIPT, '--repo', repo.dir, '--add', 'm0-gates/x', TEST_FILE, OTHER_TEST],
      { encoding: 'utf8' }
    )
    expect(run.status).toBe(0)
    const written = JSON.parse(readFileSync(join(repo.dir, 'tests/locks.json'), 'utf8'))
    expect(written).toEqual({
      [TEST_FILE]: { sha256: sha(SPEC_V1), story: 'm0-gates/x' },
      [OTHER_TEST]: { sha256: sha(SPEC_V1), story: 'm0-gates/x' }
    })
  })
})
