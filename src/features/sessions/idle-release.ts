/**
 * The decision to release idle agent processes (decision 0006, spec S9). The module is pure: the
 * time comes in as a value, and the caller closes the processes.
 */

/** One session with an open process, and what the release needs to know about it. */
export interface OpenSession {
  id: string
  startedBy: 'person' | 'automation'
  /** When the session became idle. Null while the session is busy. */
  idleSince: Date | null
  /** An Aether turn runs. A session in the state Starting has one. */
  turn: boolean
  /** The open permission requests and the open questions of Claude (elicitations). */
  openRequests: number
}

export interface ReleaseLimits {
  /** The idle time after which a process closes, by who started the session. */
  releaseMs: { person: number; automation: number }
  /** The most idle processes that stay open. */
  idleLimit: number
}

const MINUTE = 60_000

/** The times and the limit of decision 0006. They are constants (spec S9, open choice 2, A). */
export const RELEASE_LIMITS: ReleaseLimits = {
  releaseMs: { person: 30 * MINUTE, automation: 2 * MINUTE },
  idleLimit: 6
}

interface IdleSession {
  id: string
  startedBy: OpenSession['startedBy']
  /** The time that the session has been idle, in ms. A clock that went back counts as zero. */
  idleMs: number
  /** When the idle time started, in ms. */
  since: number
}

/** The idle sessions. A session with a turn, an open request or no idle time is busy: no rule closes it (rule 3). */
function idleOf(open: readonly OpenSession[], now: Date): IdleSession[] {
  const idle: IdleSession[] = []
  for (const { id, startedBy, idleSince, turn, openRequests } of open) {
    if (turn || openRequests > 0 || idleSince === null) continue
    const since = idleSince.getTime()
    idle.push({ id, startedBy, idleMs: Math.max(0, now.getTime() - since), since })
  }
  return idle
}

/** The earliest idle time first. A tie goes to the lower ID, by plain string order. */
const oldestFirst = (a: IdleSession, b: IdleSession): number => a.since - b.since || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * The IDs of the sessions to close, in the order of closing.
 *
 * Rule 1: an idle session closes when its idle time reaches the release time.
 * Rule 2: when more than `idleLimit` idle sessions stay after rule 1, the oldest closes first, until
 * `idleLimit` stay.
 */
export function sessionsToRetire(open: readonly OpenSession[], now: Date, limits: ReleaseLimits): string[] {
  const expired: IdleSession[] = []
  const staying: IdleSession[] = []
  for (const session of idleOf(open, now)) {
    if (session.idleMs >= limits.releaseMs[session.startedBy]) expired.push(session)
    else staying.push(session)
  }
  const surplus = Math.max(0, staying.length - limits.idleLimit)
  const overLimit = staying.sort(oldestFirst).slice(0, surplus)
  return [...expired.sort(oldestFirst), ...overLimit].map((session) => session.id)
}
