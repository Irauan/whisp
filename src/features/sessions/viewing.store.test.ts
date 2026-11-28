import { describe, expect, it } from 'vitest'
import { Viewing } from './viewing.store'

function setup() {
  const seen: string[] = []
  return { viewing: new Viewing((id) => seen.push(id)), seen }
}

describe('Viewing', () => {
  it('starts with no viewed session and no focus', () => {
    const { viewing, seen } = setup()
    expect(viewing.viewedSession()).toBeNull()
    expect(viewing.isSeen('a')).toBe(false)
    expect(seen).toEqual([])
  })

  it('sees a session only when it is viewed and the window has the focus', () => {
    const { viewing } = setup()
    viewing.setViewed('a')
    expect(viewing.isSeen('a')).toBe(false)
    viewing.setFocused(true)
    expect(viewing.isSeen('a')).toBe(true)
    expect(viewing.isSeen('b')).toBe(false)
    viewing.setFocused(false)
    expect(viewing.isSeen('a')).toBe(false)
  })

  it('reports a session when it becomes seen: a view with the focus, or the focus on a view', () => {
    const { viewing, seen } = setup()
    viewing.setViewed('a')
    viewing.setFocused(true)
    viewing.setViewed('b')
    viewing.setViewed(null)
    viewing.setFocused(false)
    viewing.setFocused(true)
    viewing.setViewed('c')
    expect(seen).toEqual(['a', 'b', 'c'])
  })

  it('forgets the view and the focus when the window closes', () => {
    const { viewing, seen } = setup()
    viewing.setViewed('a')
    viewing.setFocused(true)
    viewing.reset()
    expect(viewing.viewedSession()).toBeNull()
    expect(viewing.isSeen('a')).toBe(false)
    viewing.setViewed('a')
    expect(seen).toEqual(['a'])
  })
})
