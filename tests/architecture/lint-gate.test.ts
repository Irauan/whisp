import { describe, expect, it } from 'vitest'
import {
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
  it('lists each current lint violation, and nothing that is fixed', () => {
    const { grew, stale } = compareWithKnown(runOxlint(['.']), readKnownViolations())
    const problems = describeProblems({ grew, stale })
    if (problems.length > 0) throw new Error(problems.join('\n'))
    expect(problems).toEqual([])
  }, 60_000)
})

describe('compareWithKnown', () => {
  const known = [{ rule: 'eslint(no-restricted-globals)', file: 'src/a.ts' }]

  it('accepts a listed occurrence', () => {
    const result = compareWithKnown([diagnostic('eslint(no-restricted-globals)', 'src/a.ts')], known)
    expect(result).toEqual({ grew: [], stale: [] })
  })

  it('reports an unlisted occurrence as growth', () => {
    const result = compareWithKnown(
      [
        diagnostic('eslint(no-restricted-globals)', 'src/a.ts'),
        diagnostic('typescript(no-floating-promises)', 'src/b.ts')
      ],
      known
    )
    expect(describeProblems(result)).toEqual([
      'Known violations grew: `typescript(no-floating-promises)` in `src/b.ts` (3:5 A message.)'
    ])
  })

  it('reports a listed entry with no occurrence as stale', () => {
    const result = compareWithKnown([], known)
    expect(describeProblems(result)).toEqual([
      'Known violation is fixed, remove it: `eslint(no-restricted-globals) in src/a.ts`'
    ])
  })

  it('ignores the entries of other tools', () => {
    const result = compareWithKnown([], [{ rule: 'no-renderer-to-main', file: 'src/a.ts' }])
    expect(result).toEqual({ grew: [], stale: [] })
  })
})
