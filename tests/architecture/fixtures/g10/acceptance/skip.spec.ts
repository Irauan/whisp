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

/* note */ test.skip('after a block comment', async () => {})

test['skip']('with a string key', async () => {})

test.skip
('with the paren on the next line', async () => {})

/*
 * A block comment over two lines, then code: the scan must still see it.
 */ test.fixme('after a block comment of two lines', async () => {})

// These are comments, not calls. They must not count: test.skip('x', async () => {})
/* test.only('y', async () => {}) */
const url = 'http://example.test/a' // The string holds two slashes. They start no comment.
test.skip('after a string with two slashes', async () => {}) // Counts.
