import { describe, expect, it } from 'vitest'
import { applySidebarEvent, groupState, replaySidebarEvents, sessionState, type SidebarItem } from './sidebar-state'

const item = (overrides: Partial<SidebarItem> = {}): SidebarItem => ({ id: 's1', status: 'idle', openCardIds: [], unread: false, revision: 3, ...overrides })
const mapOf = (...items: SidebarItem[]) => new Map(items.map((entry) => [entry.id, entry]))

describe('sessionState', () => {
  it('puts a question of the main process before the status and the mark', () => {
    expect(sessionState({ status: 'working', openCardIds: [], unread: true, asking: true })).toBe('Needs your answer')
  })

  it('gives Working for starting and working, and the mark only for an idle session', () => {
    expect(sessionState({ status: 'starting', openCardIds: [], unread: true, asking: false })).toBe('Working')
    expect(sessionState({ status: 'idle', openCardIds: [], unread: true, asking: false })).toBe('New answer')
    expect(sessionState({ status: 'idle', openCardIds: [], unread: false, asking: false })).toBeNull()
  })
})

describe('groupState', () => {
  it('shows the hand before the blue icon, and never shows Working', () => {
    expect(groupState(['Working', 'New answer', 'Needs your answer'])).toBe('Needs your answer')
    expect(groupState([null, 'New answer', 'Working'])).toBe('New answer')
    expect(groupState(['Working', null])).toBeNull()
    expect(groupState([])).toBeNull()
  })
})

describe('applySidebarEvent', () => {
  it('moves the revision on for a change that the sidebar does not show, so the next status is no gap', () => {
    const first = applySidebarEvent(mapOf(item()), { sessionId: 's1', revision: 4, change: { type: 'title', title: 'New title' } })
    expect(first?.get('s1')).toEqual(item({ revision: 4 }))
    const second = applySidebarEvent(first!, { sessionId: 's1', revision: 5, change: { type: 'status', status: 'working' } })
    expect(second?.get('s1')).toEqual(item({ revision: 5, status: 'working' }))
  })

  it('does not list a card twice, and leaves the map as it was for a session that it does not hold', () => {
    const permission = { kind: 'permission' as const, permission: { id: 'card-1' } }
    const entry = { id: 'e1', entry: { kind: 'answers' as const, answers: [] } }
    const opened = applySidebarEvent(mapOf(item({ openCardIds: ['card-1'] })), { sessionId: 's1', revision: 4, change: { type: 'card-opened', entry, card: permission } } as never)
    expect(opened?.get('s1')?.openCardIds).toEqual(['card-1'])
    const items = mapOf(item())
    expect(applySidebarEvent(items, { sessionId: 'other', revision: 9, change: { type: 'status', status: 'working' } })).toBe(items)
  })

  it('does not change the map it was given', () => {
    const items = mapOf(item())
    applySidebarEvent(items, { sessionId: 's1', revision: 4, change: { type: 'unread', unread: true } })
    expect(items.get('s1')).toEqual(item())
  })
})

describe('replaySidebarEvents', () => {
  const status = (revision: number, value: 'working' | 'idle', sessionId = 's1') => ({ sessionId, revision, change: { type: 'status' as const, status: value } })

  it('replays the newer events in order and skips those that the list holds', () => {
    const replayed = replaySidebarEvents(mapOf(item()), [status(3, 'working'), status(4, 'working'), status(5, 'idle'), status(6, 'working')])
    expect(replayed.gap).toBe(false)
    expect(replayed.items.get('s1')).toEqual(item({ revision: 6, status: 'working' }))
  })

  it('reports a gap, and stops at it, so the caller loads the list again', () => {
    const replayed = replaySidebarEvents(mapOf(item()), [status(4, 'working'), status(6, 'idle')])
    expect(replayed.gap).toBe(true)
    expect(replayed.items.get('s1')).toEqual(item({ revision: 4, status: 'working' }))
  })

  it('reports no gap for no events, or for events of a session that the list does not hold', () => {
    const items = mapOf(item())
    expect(replaySidebarEvents(items, [])).toEqual({ items, gap: false })
    expect(replaySidebarEvents(items, [status(9, 'working', 'other')])).toEqual({ items, gap: false })
  })
})
