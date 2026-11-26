// Fixture for G10 in an acceptance test: .only, with `test` from a fixture file.
import { expect, test } from './fixture'

test.only('runs alone', () => {
  expect(1).toBe(1)
})

test.describe.only('runs alone too', () => {
  test('inside', () => {
    expect(1).toBe(1)
  })
})
