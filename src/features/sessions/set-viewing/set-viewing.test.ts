import { describe, expect, it } from 'vitest'
import { Viewing } from '../viewing.store'
import { setViewing } from './set-viewing.contract'
import { setViewingController } from './set-viewing.controller'

describe('sessions.set-viewing', () => {
  it('sets the viewed session, and clears it with null', async () => {
    const viewing = new Viewing()
    const set = setViewingController(viewing)
    const result = await set({ sessionId: 's1' })
    expect(result).toEqual({ ok: true, value: {} })
    expect(setViewing.output.safeParse(result).success).toBe(true)
    expect(viewing.viewedSession()).toBe('s1')
    await set({ sessionId: null })
    expect(viewing.viewedSession()).toBeNull()
  })

  it('reports a session that becomes seen while the window has the focus', async () => {
    const seen: string[] = []
    const viewing = new Viewing((id) => seen.push(id))
    viewing.setFocused(true)
    await setViewingController(viewing)({ sessionId: 's1' })
    expect(seen).toEqual(['s1'])
  })

  it('accepts only text or null for the session', () => {
    for (const input of setViewing.examples.valid) expect(setViewing.input.safeParse(input).success).toBe(true)
    for (const input of setViewing.examples.invalid) expect(setViewing.input.safeParse(input).success).toBe(false)
  })
})
