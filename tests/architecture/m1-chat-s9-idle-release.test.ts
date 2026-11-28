// Story S9 of milestone m1-chat (idle release and process limit): the time rules, as unit tests of
// the pure function. Spec: `docs/milestones/m1-chat/stories/s9-idle-release.md`.
//
// S9-1: an automated session closes after 2 minutes, a person's session does not.
// S9-2: a session with an open permission request, an open question of Claude, or a turn, never closes.
// The rules of A21 (rule 1, 30 minutes for a person) and A22 (rule 2, the idle limit of 6) also run
// here at the unit level. A21 runs as a slice in `m1-chat-s9-retire-idle.test.ts`, and A22 on the
// built app in `tests/acceptance/m1-chat/s9/`.
//
// Coordinator decision: the time rules run as locked vitest tests outside `tests/acceptance/`, as
// `contracts.test.ts` does. They live here, because `tsconfig.main.json` typechecks this folder.
//
// The interface that this test reads (S9 test contract). The spec gives the names "for example";
// this test fixes them:
// - `src/features/sessions/idle-release.ts` exports the pure function of the spec:
//     sessionsToRetire(open: readonly OpenSession[], now: Date, limits: ReleaseLimits): string[]
//   with `OpenSession` and `ReleaseLimits` as the spec gives them. It returns the IDs of the
//   sessions to close, in any order.
// - The same module exports `RELEASE_LIMITS: ReleaseLimits`, the constants of open choice 2 (A):
//   30 minutes for a person, 2 minutes for an automation, and the idle limit 6.
//
// Readings of the rules, from the spec text:
// - Rule 1: a process closes when its idle time "reaches" the release time, so at exactly 30
//   minutes (or 2 minutes), not 1 ms before.
// - Rule 2: "more than 6" idle closes the oldest, "until 6 stay". Exactly 6 closes none.
// - A tie of idle times goes to the lower session ID, in the order of the strings.
// - "The clock goes back": an idle time in the future counts as zero, so the process stays.
// - A busy session (a turn, or an open request) never closes, whatever its `idleSince` holds.
//
// The test loads the module at run time, so the typecheck does not depend on a file that the story adds.
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../..')
const MODULE = 'src/features/sessions/idle-release.ts'

/** One session with an open process, as the spec gives it. */
interface OpenSession {
  id: string
  startedBy: 'person' | 'automation'
  /** Null while the session is busy. */
  idleSince: Date | null
  turn: boolean
  /** Permission requests and questions of Claude (elicitations). */
  openRequests: number
}

interface ReleaseLimits {
  releaseMs: { person: number; automation: number }
  idleLimit: number
}

interface IdleRelease {
  sessionsToRetire(open: readonly OpenSession[], now: Date, limits: ReleaseLimits): string[]
  RELEASE_LIMITS: ReleaseLimits
}

const MINUTE = 60_000
/** The limits of the spec: 30 minutes for a person, 2 for an automation, at most 6 idle processes. */
const LIMITS: ReleaseLimits = { releaseMs: { person: 30 * MINUTE, automation: 2 * MINUTE }, idleLimit: 6 }
const NOW = new Date('2026-03-01T12:00:00.000Z')
/** The time `ms` before NOW. */
const before = (ms: number) => new Date(NOW.getTime() - ms)

async function load(check: string): Promise<IdleRelease> {
  if (!existsSync(join(ROOT, MODULE))) {
    throw new Error(`${check}: the pure function of the release does not exist: ${MODULE} is missing.`)
  }
  const loaded = (await import(join(ROOT, MODULE))) as Partial<IdleRelease>
  if (typeof loaded.sessionsToRetire !== 'function') throw new Error(`${check}: ${MODULE} exports no function sessionsToRetire.`)
  return loaded as IdleRelease
}

/** Calls the pure function and sorts its answer: the order of the IDs is free. */
async function retire(check: string, open: OpenSession[], now = NOW, limits = LIMITS): Promise<string[]> {
  const { sessionsToRetire } = await load(check)
  return [...sessionsToRetire(open, now, limits)].sort()
}

/** An idle session: no turn, no open request, idle since `idleFor` ms before NOW. */
const idle = (id: string, idleFor: number, startedBy: OpenSession['startedBy'] = 'person'): OpenSession => ({
  id,
  startedBy,
  idleSince: before(idleFor),
  turn: false,
  openRequests: 0
})

describe('S9-1: an automated session closes after 2 minutes, a person\'s session does not', () => {
  it('S9-1: after 2 minutes of idle time the automated session closes, and the person\'s session stays', async () => {
    const closed = await retire('S9-1', [idle('automated', 2 * MINUTE, 'automation'), idle('person', 2 * MINUTE, 'person')])
    expect(closed, 'S9-1: after 2 minutes, only the automated session must close.').toEqual(['automated'])
  })

  it('S9-1: 1 ms before 2 minutes, the automated session stays', async () => {
    const closed = await retire('S9-1', [idle('automated', 2 * MINUTE - 1, 'automation')])
    expect(closed, 'S9-1: the idle time of the automated session has not reached 2 minutes, so it must stay.').toEqual([])
  })

  it('S9-1: the person\'s session stays until 30 minutes, and closes when its idle time reaches 30 minutes (A21, rule 1)', async () => {
    expect(await retire('S9-1', [idle('person', 30 * MINUTE - 1)]), 'S9-1: 1 ms before 30 minutes, the person\'s session must stay.').toEqual([])
    expect(await retire('S9-1', [idle('person', 30 * MINUTE)]), 'A21 (rule 1): at 30 minutes, the person\'s session must close.').toEqual([
      'person'
    ])
  })

  it('S9-1: the function takes the release times from its limits', async () => {
    const limits: ReleaseLimits = { releaseMs: { person: 10 * MINUTE, automation: 1 * MINUTE }, idleLimit: 6 }
    const closed = await retire('S9-1', [idle('person', 10 * MINUTE), idle('automated', 1 * MINUTE, 'automation'), idle('fresh', 1 * MINUTE)], NOW, limits)
    expect(closed, 'S9-1: the release times must come from the limits that the caller passes.').toEqual(['automated', 'person'])
  })

  it('S9-1: the constants are 30 minutes for a person, 2 minutes for an automation, and an idle limit of 6 (open choice 2, A)', async () => {
    const { RELEASE_LIMITS } = await load('S9-1')
    expect(RELEASE_LIMITS, `S9-1: ${MODULE} must export RELEASE_LIMITS with the times and the limit of the spec.`).toEqual(LIMITS)
  })

  it('S9-1: an idle time in the future, after the clock went back, counts as zero, so the process stays', async () => {
    const future = new Date(NOW.getTime() + 60 * MINUTE)
    const open: OpenSession[] = [
      { id: 'person', startedBy: 'person', idleSince: future, turn: false, openRequests: 0 },
      { id: 'automated', startedBy: 'automation', idleSince: future, turn: false, openRequests: 0 }
    ]
    expect(await retire('S9-1', open), 'S9-1 (the clock goes back): a session idle since a time after now must stay.').toEqual([])
  })
})

describe('S9-2: a session with an open permission request, an open question of Claude, or a turn, never closes', () => {
  const LONG = 24 * 60 * MINUTE

  it('S9-2: a session with a turn never closes for the release time, also with an old idle time', async () => {
    const open: OpenSession[] = [
      { id: 'turn', startedBy: 'person', idleSince: before(LONG), turn: true, openRequests: 0 },
      { id: 'turn-automated', startedBy: 'automation', idleSince: before(LONG), turn: true, openRequests: 0 }
    ]
    expect(await retire('S9-2', open), 'S9-2: a session with a turn must never close.').toEqual([])
  })

  it('S9-2: a session in the state Starting (a turn, no idle time) never closes', async () => {
    const open: OpenSession[] = [{ id: 'starting', startedBy: 'automation', idleSince: null, turn: true, openRequests: 0 }]
    expect(await retire('S9-2', open), 'S9-2 (rule 3): a session that starts must never close.').toEqual([])
  })

  it('S9-2: a session with an open permission request and no turn never closes', async () => {
    const open: OpenSession[] = [
      { id: 'permission', startedBy: 'person', idleSince: before(LONG), turn: false, openRequests: 1 },
      { id: 'permission-automated', startedBy: 'automation', idleSince: before(LONG), turn: false, openRequests: 1 }
    ]
    expect(await retire('S9-2', open), 'S9-2: a session with an open permission request must never close, also outside a turn.').toEqual([])
  })

  it('S9-2: a session with an open question of Claude and no turn never closes', async () => {
    // `openRequests` counts the permission requests and the questions of Claude (elicitations).
    const open: OpenSession[] = [{ id: 'question', startedBy: 'automation', idleSince: null, turn: false, openRequests: 1 }]
    expect(await retire('S9-2', open), 'S9-2: a session with an open question of Claude must never close.').toEqual([])
  })

  it('S9-2: above the idle limit, a busy session never closes, also when its idle time is the oldest', async () => {
    const open: OpenSession[] = [
      { id: 'busy-turn', startedBy: 'person', idleSince: before(25 * MINUTE), turn: true, openRequests: 0 },
      { id: 'busy-request', startedBy: 'person', idleSince: before(24 * MINUTE), turn: false, openRequests: 2 },
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => idle(`idle-${n}`, (10 - n) * MINUTE))
    ]
    expect(
      await retire('S9-2', open),
      'S9-2 (A22): with 7 idle sessions and 2 busy ones, only the oldest idle session must close, never a busy one.'
    ).toEqual(['idle-1'])
  })
})

describe('A22 (rule 2): at most 6 idle processes stay, the oldest idle one closes first', () => {
  it('A22: 6 idle sessions all stay', async () => {
    const open = [1, 2, 3, 4, 5, 6].map((n) => idle(`idle-${n}`, (10 - n) * MINUTE))
    expect(await retire('A22', open), 'A22: exactly 6 idle sessions are within the limit, so none must close.').toEqual([])
  })

  it('A22: with 7 idle sessions, the one with the earliest idle time closes', async () => {
    // The list order differs from the idle order, so the function must sort by the idle time.
    const open = [idle('c', 3 * MINUTE), idle('a', 9 * MINUTE), idle('e', 1 * MINUTE), idle('b', 8 * MINUTE), idle('d', 2 * MINUTE), idle('f', 30_000), idle('g', 10_000)]
    expect(await retire('A22', open), 'A22: with 7 idle sessions, only the oldest idle one must close.').toEqual(['a'])
  })

  it('A22: with 8 idle sessions, the two oldest close, until 6 stay', async () => {
    const open = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => idle(`idle-${n}`, (10 - n) * MINUTE))
    expect(await retire('A22', open), 'A22: with 8 idle sessions, the two oldest must close, so that 6 stay.').toEqual(['idle-1', 'idle-2'])
  })

  it('A22: a tie of idle times goes to the lower session ID', async () => {
    const open = [idle('b', 9 * MINUTE), idle('a', 9 * MINUTE), ...[1, 2, 3, 4, 5].map((n) => idle(`idle-${n}`, n * 1000))]
    expect(await retire('A22', open), 'A22: two sessions with the same idle time: the lower session ID must close first.').toEqual(['a'])
  })
})
