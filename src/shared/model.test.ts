import { describe, expect, it } from 'vitest'
import { baseName, labelOf, MODELS, parseRequest } from './model'

describe('parseRequest', () => {
  it('splits the title from the description', () => {
    expect(parseRequest('  Add login \n\nUse OAuth\n')).toEqual({
      title: 'Add login',
      description: 'Use OAuth'
    })
  })

  it('refuses blank text', () => {
    expect(parseRequest(' \n ')).toBeNull()
  })
})

it('reads the last part of a path', () => {
  expect(baseName('C:\\work\\app\\')).toBe('app')
  expect(baseName('/home/me/app')).toBe('app')
  expect(baseName('/')).toBe('/')
})

it('finds the label of an option and falls back to its id', () => {
  expect(labelOf(MODELS, 'claude-opus-5-5')).toBe('Opus 5.5')
  expect(labelOf(MODELS, 'unknown-model')).toBe('unknown-model')
})
