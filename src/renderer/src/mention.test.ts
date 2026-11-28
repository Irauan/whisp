import { describe, expect, it } from 'vitest'
import { findMention, insertTrigger, removeMention } from './mention'

describe('findMention', () => {
  it('finds a mention at the start and after a space', () => {
    expect(findMention('@src', 4)).toEqual({ trigger: '@', query: 'src', start: 0 })
    expect(findMention('fix #12 now', 7)).toEqual({ trigger: '#', query: '12', start: 4 })
    expect(findMention('line\n@docs', 10)).toEqual({ trigger: '@', query: 'docs', start: 5 })
  })

  it('ignores a trigger in a word and a finished mention', () => {
    expect(findMention('me@example', 10)).toBeNull()
    expect(findMention('a # b', 5)).toBeNull()
    expect(findMention('# Title', 7)).toBeNull()
  })

  it('does not treat & as a trigger: the session attachment is coming soon', () => {
    expect(findMention('&', 1)).toBeNull()
    expect(findMention('line\n&', 6)).toBeNull()
    expect(findMention('see &login', 10)).toBeNull()
  })
})

it('removes the mention and keeps the other text', () => {
  const mention = findMention('fix #12 now', 7)
  expect(mention && removeMention('fix #12 now', 7, mention)).toEqual({ text: 'fix  now', caret: 4 })
})

it('adds a space before a trigger when one is missing', () => {
  expect(insertTrigger('', 0, '@')).toEqual({ text: '@', caret: 1 })
  expect(insertTrigger('fix', 3, '#')).toEqual({ text: 'fix #', caret: 5 })
  expect(insertTrigger('fix ', 4, '@')).toEqual({ text: 'fix @', caret: 5 })
})
