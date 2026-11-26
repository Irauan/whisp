// Fixture for G10: .skip in a test.
import { describe, expect, it } from 'vitest'

describe.skip('skipped suite', () => {
  it.skip('skipped test', () => {
    expect(1).toBe(1)
  })
})
