import { describe, expect, it } from 'vitest'
import {
  assertTypeAwareRuns,
  compareWithKnown,
  describeProblems,
  readKnownViolations,
  runOxlint
} from '../../scripts/lint-gate.mjs'

const diagnostic = (rule: string, file: string) => ({
  rule,
  file,
  line: 3,
  column: 5,
  message: 'A message.'
})

describe('lint known violations', () => {
  it('lists each current lint violation with its count, and nothing that is fixed', () => {
    const problems = describeProblems(compareWithKnown(runOxlint(['.']), readKnownViolations()))
    if (problems.length > 0) throw new Error(problems.join('\n'))
    expect(problems).toEqual([])
  }, 60_000)

  it('runs the type-aware rules', () => {
    expect(() => assertTypeAwareRuns()).not.toThrow()
  }, 60_000)
})

describe('compareWithKnown', () => {
  const rule = 'eslint(no-restricted-globals)'
  const known = [{ rule, file: 'src/a.ts', count: 2 }]
  const twice = [diagnostic(rule, 'src/a.ts'), diagnostic(rule, 'src/a.ts')]

  it('accepts the listed count', () => {
    expect(describeProblems(compareWithKnown(twice, known))).toEqual([])
  })

  it('reports an unlisted file as growth', () => {
    const result = compareWithKnown(
      [...twice, diagnostic('typescript(no-floating-promises)', 'src/b.ts')],
      known
    )
    expect(describeProblems(result)).toEqual([
      'Known violations grew: `typescript(no-floating-promises)` in `src/b.ts` (1 found, 0 listed; first at 3:5 A message.)'
    ])
  })

  it('reports a count that went up as growth', () => {
    const result = compareWithKnown([...twice, diagnostic(rule, 'src/a.ts')], known)
    expect(describeProblems(result)).toEqual([
      `Known violations grew: \`${rule}\` in \`src/a.ts\` (3 found, 2 listed; first at 3:5 A message.)`
    ])
  })

  it('reports a count that went down and asks to lower it', () => {
    const result = compareWithKnown([diagnostic(rule, 'src/a.ts')], known)
    expect(describeProblems(result)).toEqual([
      `Known violation is fixed, lower the count: \`${rule} in src/a.ts\` from 2 to 1`
    ])
  })

  it('reports an entry with no occurrence and asks to remove it', () => {
    const result = compareWithKnown([], known)
    expect(describeProblems(result)).toEqual([
      `Known violation is fixed, remove it: \`${rule} in src/a.ts\``
    ])
  })

  it('refuses a lint entry without a count', () => {
    expect(() => compareWithKnown([], [{ rule, file: 'src/a.ts' }])).toThrow('no valid count')
  })

  it('ignores the entries of other tools', () => {
    const result = compareWithKnown([], [{ rule: 'no-renderer-to-main', file: 'src/a.ts', count: 1 }])
    expect(describeProblems(result)).toEqual([])
  })
})
