import { describe, expect, it } from 'vitest'
import { RELEASE_LIMITS, sessionsToRetire, type OpenSession, type ReleaseLimits } from './idle-release'

// The locked tests of S9 (tests/architecture/m1-chat-s9-idle-release.test.ts) cover rules 1 to 3.
// These tests cover what they leave open: the overlap of rule 1 and rule 2 in one pass, and the input.

const MINUTE = 60_000
const NOW = new Date('2026-03-01T12:00:00.000Z')
const idle = (id: string, idleFor: number, startedBy: OpenSession['startedBy'] = 'person'): OpenSession => ({
  id,
  startedBy,
  idleSince: new Date(NOW.getTime() - idleFor),
  turn: false,
  openRequests: 0
})
const sorted = (ids: string[]) => [...ids].sort()

describe('sessionsToRetire: rule 1 and rule 2 in one pass', () => {
  it('has the limits of decision 0006', () => {
    expect(RELEASE_LIMITS).toEqual({ releaseMs: { person: 30 * MINUTE, automation: 2 * MINUTE }, idleLimit: 6 })
  })

  it('applies rule 1 first: rule 2 counts only the idle sessions that stay, so 6 stay', () => {
    // Eight idle sessions. The automated one is past its 2 minutes but is not among the oldest.
    const open = [
      idle('auto', 3 * MINUTE, 'automation'),
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => idle(`p${n}`, (20 - n) * MINUTE)) // 19 to 13 minutes: older than auto
    ]
    // Rule 1 closes `auto`. Seven remain, so rule 2 closes the oldest of them: p1. Six stay.
    expect(sorted(sessionsToRetire(open, NOW, RELEASE_LIMITS))).toEqual(['auto', 'p1'])
  })

  it('does not close more than rule 1 asks when the sessions that stay are within the limit', () => {
    const open = [idle('auto', 3 * MINUTE, 'automation'), ...[1, 2, 3, 4, 5, 6].map((n) => idle(`p${n}`, n * 1000))]
    expect(sessionsToRetire(open, NOW, RELEASE_LIMITS)).toEqual(['auto'])
  })

  it('counts a session with no idle time as busy, also when many sessions are idle', () => {
    const limits: ReleaseLimits = { releaseMs: { person: 30 * MINUTE, automation: 2 * MINUTE }, idleLimit: 1 }
    const open: OpenSession[] = [{ id: 'busy', startedBy: 'person', idleSince: null, turn: false, openRequests: 0 }, idle('b', 2 * MINUTE), idle('a', 1 * MINUTE)]
    // One idle session stays, the older one closes.
    expect(sessionsToRetire(open, NOW, limits)).toEqual(['b'])
  })

  it('returns nothing for an empty list, and closes every idle session when the limit is zero', () => {
    expect(sessionsToRetire([], NOW, RELEASE_LIMITS)).toEqual([])
    const limits: ReleaseLimits = { releaseMs: { person: 60 * MINUTE, automation: 60 * MINUTE }, idleLimit: 0 }
    expect(sessionsToRetire([idle('a', 5 * MINUTE)], NOW, limits)).toEqual(['a'])
  })

  it('compares the IDs as plain strings, with no locale', () => {
    const open = [idle('B', 9 * MINUTE), idle('a', 9 * MINUTE), ...[1, 2, 3, 4, 5].map((n) => idle(`idle-${n}`, n * 1000))]
    // In plain order "B" comes before "a".
    expect(sessionsToRetire(open, NOW, RELEASE_LIMITS)).toEqual(['B'])
  })

  it('does not change the list that it gets', () => {
    const open = [idle('b', 2 * MINUTE), idle('a', 1 * MINUTE)]
    const copy = structuredClone(open)
    sessionsToRetire(open, NOW, { ...RELEASE_LIMITS, idleLimit: 1 })
    expect(open).toEqual(copy)
  })
})
