import { expect, it } from 'vitest'
import { err, ok } from './result'

it('builds a success with a value', () => {
  expect(ok(3)).toEqual({ ok: true, value: 3 })
})

it('builds an error with a code and a message', () => {
  expect(err('github-cli-missing', 'No gh.')).toEqual({
    ok: false,
    error: { code: 'github-cli-missing', message: 'No gh.' }
  })
})
