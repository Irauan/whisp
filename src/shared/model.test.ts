import { describe, expect, it } from 'vitest'
import { MODE_LABELS, MODES } from '../building-blocks/mode'
import { baseName, labelOf, MODE_OPTIONS, MODELS, parseRequest } from './model'

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

describe('MODE_OPTIONS', () => {
  it('lists the five modes of the agent port, in the order of the Mode control', () => {
    expect(MODE_OPTIONS.map((option) => option.id)).toEqual([...MODES])
    expect(MODE_OPTIONS.map((option) => option.label)).toEqual(['Ask', 'Accept edits', 'Plan', 'Auto', 'Approve all'])
    // The notices of the main process use the labels of the building block: they must read as the menu does.
    expect(MODE_OPTIONS.map((option) => MODE_LABELS[option.id])).toEqual(MODE_OPTIONS.map((option) => option.label))
  })

  it('has no option about tool permissions', () => {
    expect(JSON.stringify(MODE_OPTIONS)).not.toMatch(/tool permissions/i)
  })
})
