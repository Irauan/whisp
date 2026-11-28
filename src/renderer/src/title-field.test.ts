import { describe, expect, it } from 'vitest'
import { focusesArrowAfter } from './title-field'

describe('the end of the Rename field', () => {
  it('puts the focus back on the arrow after Enter and Escape', () => {
    expect(focusesArrowAfter('saved')).toBe(true)
    expect(focusesArrowAfter('escape')).toBe(true)
  })

  it('leaves the focus where the user clicked after a blur', () => {
    expect(focusesArrowAfter('blur')).toBe(false)
  })
})
