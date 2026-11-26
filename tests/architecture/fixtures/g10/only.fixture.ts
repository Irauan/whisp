// Fixture for G10: .only in a test.
import { expect, it } from 'vitest'

it.only('runs alone', () => {
  expect(1).toBe(1)
})
