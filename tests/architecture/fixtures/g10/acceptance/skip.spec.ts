// Fixture for G10 in an acceptance test: .skip and .fixme, with `test` from a fixture file.
import { expect, test } from './fixture'

test.skip('skipped test', () => {
  expect(1).toBe(1)
})

test.describe.skip('skipped suite', () => {
  test('inside', () => {
    expect(1).toBe(1)
  })
})

test.fixme('fixme test', () => {
  expect(1).toBe(1)
})

test('skipped at run time', ({ page }) => {
  test.skip(page === undefined, 'no page')
})
