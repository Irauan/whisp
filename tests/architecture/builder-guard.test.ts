// Tests of the builder guard (S6): the PreToolUse hook of .claude/agents/builder.md blocks
// Edit and Write on the locked paths and on the real Aether data folder.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { decide } from '../../scripts/hooks/builder-guard.mjs'

const GUARD = fileURLToPath(new URL('../../scripts/hooks/builder-guard.mjs', import.meta.url))

let root: string
let appdata: string
const env = () => ({ APPDATA: appdata })

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'aether-guard-'))
  appdata = join(root, 'Roaming')
  mkdirSync(join(root, 'work/tests/acceptance'), { recursive: true })
  mkdirSync(join(root, 'work/src'), { recursive: true })
  mkdirSync(join(appdata, 'aether'), { recursive: true })
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

const work = () => join(root, 'work')

/** The decision of the guard for a path that Edit or Write receives. */
const edit = (path: string, toolName = 'Edit', cwd = work()) =>
  decide({ toolName, toolInput: { file_path: path }, cwd, env: env() })

describe('G22 and S6: locked paths', () => {
  it.each([
    'tests/acceptance/m0-gates/s5/app.spec.ts',
    'tests/acceptance/new-file.ts',
    'tests/simulated-agent/agent.mjs',
    'tests/simulated-agent/deep/er/file.ts',
    'tests/locks.json'
  ])('blocks %s as a relative path, for Edit and for Write', (path) => {
    expect(edit(path, 'Edit').block).toBe(true)
    expect(edit(path, 'Write').block).toBe(true)
  })

  it('blocks the absolute form of a locked path', () => {
    expect(edit(join(work(), 'tests/acceptance/x.ts')).block).toBe(true)
    expect(edit(join(work(), 'tests/locks.json')).block).toBe(true)
  })

  it('blocks a path with backslashes, forward slashes and a mix of both', () => {
    expect(edit('tests\\acceptance\\x.ts').block).toBe(true)
    expect(edit(`${work()}\\tests/simulated-agent\\x.mjs`).block).toBe(true)
  })

  it('blocks a path in another letter case', () => {
    expect(edit('TESTS/Acceptance/x.ts').block).toBe(true)
    expect(edit('Tests/Locks.JSON').block).toBe(true)
  })

  it('blocks a path that reaches a locked path through dot segments', () => {
    expect(edit('src/../tests/acceptance/x.ts').block).toBe(true)
    expect(edit('./tests/./locks.json').block).toBe(true)
    expect(edit('../work/tests/locks.json').block).toBe(true)
  })

  it('resolves a relative path against the folder of the call, not the folder of the hook', () => {
    expect(edit('acceptance/x.ts', 'Edit', join(work(), 'src')).block).toBe(false)
    expect(edit('acceptance/x.ts', 'Edit', join(work(), 'tests')).block).toBe(true)
    expect(edit('../tests/locks.json', 'Edit', join(work(), 'src')).block).toBe(true)
    expect(edit('locks.json', 'Edit', join(work(), 'tests')).block).toBe(true)
    expect(edit('x.ts', 'Edit', join(work(), 'tests/acceptance')).block).toBe(true)
  })

  it.each([
    'scripts/check-lock.mjs',
    'scripts/hooks/builder-guard.mjs',
    'scripts/hooks/new-hook.mjs',
    '.github/workflows/ci.yml',
    '.github/workflows/other.yml',
    '.claude/agents/builder.md',
    '.claude/agents/new-role.md',
    '.claude/settings.json'
  ])('F2: blocks %s, the files that make the lock and the guard itself', (path) => {
    expect(edit(path, 'Edit').block).toBe(true)
    expect(edit(path, 'Write').block).toBe(true)
    expect(edit(join(work(), path), 'Write').block).toBe(true)
    expect(edit(path.toUpperCase().replaceAll('/', '\\'), 'Write').block).toBe(true)
  })

  it('F2: allows the files next to them', () => {
    for (const path of [
      'scripts/lint-gate.mjs',
      'scripts/check-lock.mjs.bak',
      'scripts/hooks-notes.md',
      '.claude/settings.local.json',
      '.claude/worktrees/x/src/a.ts',
      '.github/ISSUE_TEMPLATE.md'
    ]) {
      expect(edit(path).block, path).toBe(false)
    }
  })

  it('F2: blocks the protected files inside a worktree under .claude/worktrees', () => {
    expect(edit(join(work(), '.claude/worktrees/agent-1/scripts/hooks/builder-guard.mjs')).block).toBe(true)
    expect(edit(join(work(), '.claude/worktrees/agent-1/.github/workflows/ci.yml')).block).toBe(true)
  })

  it('blocks the way Windows reads a name: a trailing dot, a trailing space, a data stream', () => {
    expect(edit('tests/acceptance./x.ts').block).toBe(true)
    expect(edit('tests/acceptance /x.ts').block).toBe(true)
    expect(edit('tests/locks.json::$DATA').block).toBe(true)
    expect(edit('tests/locks.json.').block).toBe(true)
  })

  it('blocks a path with the long-path prefix', () => {
    expect(edit(`\\\\?\\${join(work(), 'tests', 'acceptance', 'x.ts')}`).block).toBe(true)
  })

  it('blocks a path through a link to a locked folder', () => {
    const link = join(root, 'alias')
    symlinkSync(join(work(), 'tests/acceptance'), link, 'junction')
    expect(edit(join(link, 'new.ts')).block).toBe(true)
    expect(edit(join(link, 'deeper/new.ts')).block).toBe(true)
  })

  it('names the path and the reason', () => {
    const decision = edit('tests/locks.json')
    expect(decision.reason).toContain('tests/locks.json')
    expect(decision.reason).toMatch(/locked/i)
  })

  it('allows the other test folders and the code', () => {
    for (const path of [
      'src/main/index.ts',
      'tests/architecture/check-lock.test.ts',
      'tests/architecture/fixtures/g-composition-root/src/main/index.ts',
      'scripts/zone-coverage.mjs',
      'docs/milestones/m0-gates/plan.md',
      'tests/acceptance-notes.md',
      'tests/locks.json.bak',
      'tests/simulated-agent-notes.md',
      'docs/agents/builder.md'
    ]) {
      expect(edit(path).block, path).toBe(false)
    }
  })
})

describe('S6: the real Aether data folder', () => {
  it('blocks the folder of the Aether data under APPDATA, absolute or with variations', () => {
    expect(edit(join(appdata, 'aether', 'agents.json')).block).toBe(true)
    expect(edit(join(appdata, 'aether', 'runs', 'r1', 'log.json')).block).toBe(true)
    expect(edit(join(appdata, 'AETHER', 'workspace.json')).block).toBe(true)
    expect(edit(`${appdata}\\aether\\..\\aether\\x.json`).block).toBe(true)
    expect(edit(join(appdata, 'aether'), 'Write').block).toBe(true)
  })

  it('blocks it from any working folder, with a relative path', () => {
    const relative = `..\\..\\Roaming\\aether\\agents.json`
    expect(edit(relative, 'Write', join(root, 'work/src')).block).toBe(true)
  })

  it('expands a leading tilde to the home folder, for a data folder path and a locked path', () => {
    const decision = (path: string) => decide({ toolName: 'Write', toolInput: { file_path: path }, cwd: work(), env: {} })
    expect(decision('~/AppData/Roaming/aether/agents.json').block).toBe(true)
    expect(decision('~\\AppData\\Roaming\\aether\\agents.json').block).toBe(true)
    expect(decision('~').block).toBe(false)
    expect(decision('~/notes.txt').block).toBe(false)
    expect(decision('~/repo/tests/locks.json').block).toBe(true)
  })

  it('does not treat a name that merely starts with a tilde as the home folder', () => {
    const decision = decide({ toolName: 'Write', toolInput: { file_path: '~aether/x.json' }, cwd: work(), env: env() })
    expect(decision.block).toBe(false)
  })

  it('blocks the folder that AETHER_DATA_DIR names, when it is set', () => {
    const custom = join(root, 'custom-data')
    const decision = decide({
      toolName: 'Write',
      toolInput: { file_path: join(custom, 'agents.json') },
      cwd: work(),
      env: { APPDATA: appdata, AETHER_DATA_DIR: custom }
    })
    expect(decision.block).toBe(true)
  })

  it('allows a folder whose name only starts like the data folder, and a fake profile', () => {
    expect(edit(join(appdata, 'aether-fake', 'agents.json')).block).toBe(false)
    expect(edit(join(appdata, 'aetherx', 'agents.json')).block).toBe(false)
    expect(edit(join(root, 'fake-profile', 'aether', 'agents.json')).block).toBe(false)
  })

  it('finds the data folder when APPDATA is unset, from the home folder', () => {
    const decision = decide({
      toolName: 'Edit',
      toolInput: { file_path: join(homedir(), 'AppData', 'Roaming', 'aether', 'agents.json') },
      cwd: work(),
      env: {}
    })
    expect(decision.block).toBe(true)
  })
})

describe('the tools that the guard judges', () => {
  it('judges Edit, Write, MultiEdit and NotebookEdit', () => {
    expect(decide({ toolName: 'MultiEdit', toolInput: { file_path: 'tests/locks.json' }, cwd: work(), env: env() }).block).toBe(true)
    expect(decide({ toolName: 'NotebookEdit', toolInput: { notebook_path: 'tests/acceptance/n.ipynb' }, cwd: work(), env: env() }).block).toBe(true)
  })

  it('leaves other tools alone', () => {
    for (const toolName of ['Read', 'Bash', 'Glob', 'Grep']) {
      const decision = decide({ toolName, toolInput: { file_path: 'tests/locks.json', command: 'cat tests/locks.json' }, cwd: work(), env: env() })
      expect(decision.block, toolName).toBe(false)
    }
  })

  it('blocks an Edit or a Write that gives no path, because it cannot check it', () => {
    expect(decide({ toolName: 'Edit', toolInput: {}, cwd: work(), env: env() }).block).toBe(true)
    expect(decide({ toolName: 'Write', toolInput: { file_path: 42 }, cwd: work(), env: env() }).block).toBe(true)
    expect(decide({ toolName: 'Write', toolInput: undefined, cwd: work(), env: env() }).block).toBe(true)
  })
})

describe('the hook in builder.md', () => {
  const frontmatter = readFileSync(new URL('../../.claude/agents/builder.md', import.meta.url), 'utf8')
    .replaceAll('\r\n', '\n')
    .split('\n---\n')[0]

  it('runs the guard on Edit and Write, with Node and an argument list, and blocks on failure', () => {
    expect(frontmatter).toMatch(/PreToolUse:/)
    expect(frontmatter).toMatch(/matcher: "Edit\|Write"/)
    expect(frontmatter).toMatch(/command: node\n/)
    expect(frontmatter).toContain('args: ["${CLAUDE_PROJECT_DIR}/scripts/hooks/builder-guard.mjs"]')
    expect(frontmatter).toMatch(/onFailure: block/)
  })
})

describe('the hook command', () => {
  const run = (input: string, hookEnv: Record<string, string> = env()) =>
    spawnSync(process.execPath, [GUARD], {
      input,
      encoding: 'utf8',
      env: { ...process.env, ...hookEnv }
    })

  it('exits with 2 and explains on stderr when it blocks', () => {
    const input = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: 'tests/acceptance/x.ts', content: 'x' },
      cwd: work()
    })
    const result = run(input)
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('tests/acceptance/x.ts')
  })

  it('exits with 0 when it allows', () => {
    const input = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: 'src/main/index.ts' },
      cwd: work()
    })
    expect(run(input).status).toBe(0)
  })

  it('blocks when the input is not JSON, because it cannot judge the call', () => {
    const result = run('not json')
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/input/i)
  })

  it('uses its own folder when the input has no cwd', () => {
    const input = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'tests/locks.json' } })
    expect(run(input).status).toBe(2)
  })
})
