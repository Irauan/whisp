import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FIXTURES } from '../../scripts/lint-gate.mjs'
import { ROOT, findUncoveredFiles } from '../../scripts/zone-coverage.mjs'

describe('zone coverage', () => {
  it('puts each source file under src in at least one zone config', () => {
    const uncovered = findUncoveredFiles()
    if (uncovered.length > 0) {
      throw new Error(uncovered.map((file) => `File is in no zone config: ${file}`).join('\n'))
    }
    expect(uncovered).toEqual([])
  }, 120_000)

  it('names a file that is in no config', () => {
    const uncovered = findUncoveredFiles({
      root: join(ROOT, FIXTURES, 'g-zones'),
      configs: ['tsconfig.json']
    })
    expect(uncovered).toEqual(['src/orphan.tsx'])
  }, 60_000)
})
