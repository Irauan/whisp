// RED PROBE (G10): .only in a test. Do not merge.
import { describe, expect, it } from 'vitest'

describe('red probe', () => {
  it.only('runs alone', () => {
    expect(1).toBe(1)
  })
})
