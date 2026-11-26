// RED PROBE (unit gate): a unit test that fails. Do not merge.
import { describe, expect, it } from 'vitest'

describe('red probe', () => {
  it('fails on purpose', () => {
    expect(1 + 1).toBe(3)
  })
})
