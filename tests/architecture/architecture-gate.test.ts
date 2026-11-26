// Tests of the architecture gate (S3): the import rules of .dependency-cruiser.cjs run on the
// fixtures, and the gate compares the result with the known violations.
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  FIXTURES,
  ROOT,
  assertSwcParserRuns,
  compareImports,
  describeProblems,
  findUncruisedFiles,
  importRuleNames,
  runDepcruise
} from '../../scripts/architecture-gate.mjs'
import { readKnownViolations } from '../../scripts/lint-gate.mjs'

const fixture = (name: string) => join(ROOT, FIXTURES, name)

/** The violations of a fixture, as sorted `rule file` strings. */
function found(name: string) {
  return runDepcruise({ cwd: fixture(name) })
    .diagnostics.map((d) => `${d.rule} ${d.file}`)
    .sort()
}

function runGate(args: string[], env: Record<string, string> = {}) {
  const run = spawnSync(process.execPath, [join(ROOT, 'scripts/architecture-gate.mjs'), ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env }
  })
  return { status: run.status, output: `${run.stdout}${run.stderr}` }
}

describe('G8: the current code', () => {
  it('passes, and each current violation is in the known violations', () => {
    const { diagnostics, modules } = runDepcruise()
    expect(findUncruisedFiles(modules)).toEqual([])
    const problems = describeProblems(compareImports(diagnostics, readKnownViolations()))
    if (problems.length > 0) throw new Error(problems.join('\n'))
    expect(problems).toEqual([])
  }, 60_000)

  it('passes through the command', () => {
    const { status, output } = runGate([])
    expect(output).toContain('architecture: passed')
    expect(status).toBe(0)
  }, 60_000)

  it('keeps import entries out of the rule names of the lint gate', () => {
    for (const name of importRuleNames()) expect(name).not.toMatch(/[()]/)
  })
})

describe('G5: the renderer imports no main code', () => {
  it('fails on a renderer file that imports from src/main', () => {
    expect(found('g5')).toEqual(['renderer-imports-no-main src/renderer/imports-main.ts'])
  }, 60_000)
})

describe('G7: fixtures that break a rule', () => {
  it('fails on an import cycle', () => {
    const rules = runDepcruise({ cwd: fixture('g7-cycle') }).diagnostics
    expect(rules.length).toBeGreaterThan(0)
    for (const d of rules) {
      expect(d.rule).toBe('no-circular')
      expect(['src/shared/a.ts', 'src/shared/b.ts']).toContain(d.file)
      expect(d.message).toContain('src/shared/a.ts')
      expect(d.message).toContain('src/shared/b.ts')
    }
  }, 60_000)

  it('fails on a provider that imports a feature', () => {
    expect(found('g7-provider')).toEqual(['providers-import-no-features src/providers/acp/client.ts'])
  }, 60_000)

  it('fails on a slice that imports another slice', () => {
    expect(found('g7-slice')).toEqual([
      'no-slice-to-slice src/features/sessions/send-message/send-message.handler.ts'
    ])
  }, 60_000)

  it('fails on a domain file that imports Node', () => {
    expect(found('g7-domain')).toEqual([
      'domain-imports-no-node-electron-react src/features/sessions/session.ts'
    ])
  }, 60_000)
})

describe('the other import rules', () => {
  it('fails on each of them in the target layout', () => {
    expect(found('g-imports-more')).toEqual(
      [
        'domain-imports-no-node-electron-react src/features/sessions/session.ts',
        'only-app-main-imports-providers src/features/sessions/stop/stop.handler.ts',
        'renderer-imports-no-main src/renderer/view.tsx',
        'renderer-imports-only-allowed src/renderer/view.tsx',
        'slice-imports-no-other-feature-root src/features/sessions/list/list.handler.ts',
        'slice-imports-only-allowed src/features/sessions/list/list.handler.ts',
        'slice-imports-only-allowed src/features/sessions/stop/stop.handler.ts'
      ].sort()
    )
  }, 60_000)

  it('passes on the valid imports of the target layout', () => {
    expect(found('g-imports-ok')).toEqual([])
  }, 60_000)

  it('passes when a folder of a rule does not exist', () => {
    // The current code has no src/features, src/app, src/providers or src/building-blocks.
    const { modules } = runDepcruise()
    expect(modules.some((module) => /^src\/(features|app|providers|building-blocks)\//.test(module))).toBe(
      false
    )
    expect(runDepcruise().diagnostics).toEqual([])
  }, 60_000)
})

describe('G9: a changed list of violations', () => {
  const rule = 'renderer-imports-no-main'
  const file = 'src/renderer/a.ts'
  const diagnostic = { rule, file, line: 0, column: 0, message: 'imports src/main/b.ts' }

  it('fails on a violation that is not listed and names the rule and the file', () => {
    const { status, output } = runGate([
      '--root',
      fixture('g9-added'),
      '--known',
      join(fixture('g9-added'), 'known-violations.json')
    ])
    expect(status).toBe(1)
    expect(output).toContain(
      'Known violations grew: `renderer-imports-no-main` in `src/renderer/view.ts` (1 found, 0 listed; first imports src/main/secret.ts)'
    )
    // The lint entry of the list is not an import entry: the gate does not report it.
    expect(output).not.toContain('no-floating-promises')
  }, 60_000)

  it('fails on a fixed violation whose entry remains and names the entry', () => {
    const { status, output } = runGate([
      '--root',
      fixture('g9-fixed'),
      '--known',
      join(fixture('g9-fixed'), 'known-violations.json')
    ])
    expect(status).toBe(1)
    expect(output).toContain(
      'Known violation is fixed, remove it: `renderer-imports-no-main in src/renderer/view.ts`'
    )
  }, 60_000)

  it('passes on a listed violation', () => {
    const { status, output } = runGate([
      '--root',
      fixture('g9-listed'),
      '--known',
      join(fixture('g9-listed'), 'known-violations.json')
    ])
    expect(output).toContain('architecture: passed')
    expect(status).toBe(0)
  }, 60_000)

  it('reports a new violation in a listed file as growth', () => {
    const known = [{ rule, file, count: 1 }]
    const problems = describeProblems(compareImports([diagnostic, diagnostic], known))
    expect(problems).toEqual([
      `Known violations grew: \`${rule}\` in \`${file}\` (2 found, 1 listed; first imports src/main/b.ts)`
    ])
  })

  it('asks to lower a count that went down', () => {
    const known = [{ rule, file, count: 2 }]
    expect(describeProblems(compareImports([diagnostic], known))).toEqual([
      `Known violation is fixed, lower the count: \`${rule} in ${file}\` from 2 to 1`
    ])
  })

  it('does not own the lint entries', () => {
    const known = [{ rule: 'typescript(no-floating-promises)', file, count: 1 }]
    expect(describeProblems(compareImports([], known))).toEqual([])
  })
})

describe('the swc parser', () => {
  it('runs', () => {
    expect(() => assertSwcParserRuns()).not.toThrow()
  }, 60_000)

  it('fails the gate when @swc/core is missing, and does not pass silently', () => {
    const hook = pathToFileURL(join(ROOT, 'tests/architecture/helpers/block-swc.mjs')).href
    const { status, output } = runGate([], { NODE_OPTIONS: `--import=${hook}` })
    expect(status).toBe(1)
    expect(output).toContain('architecture: FAILED')
    expect(output).toContain('The swc parser did not run')
  }, 60_000)

  it('names a TypeScript file that dependency-cruiser did not read', () => {
    expect(findUncruisedFiles([], fixture('g-swc'))).toEqual(['src/shape.ts', 'src/typed.ts'])
  })
})
