import type { Clock } from '../../../building-blocks/clock.port'
import { sessionsToRetire, type OpenSession, type ReleaseLimits } from '../idle-release'
import type { Processes } from '../processes.store'
import type { SessionStore } from '../session.store'
import type { Transcript } from '../transcript.store'

export interface RetireIdleDeps {
  store: SessionStore
  transcript: Transcript
  processes: Processes
  clock: Clock
  limits: ReleaseLimits
  log(message: string, cause?: unknown): void
  /**
   * The open permission requests and the open questions of Claude of a session (story S5). The
   * composition root passes the count of the open cards. A session with an open card is busy.
   */
  openRequests(sessionId: string): number
}

/**
 * Closes the agent processes that the rules of decision 0006 release (spec S9). It is an event
 * consumer without a contract, like `record-agent-update`: a timer and the end of a turn call it.
 *
 * It reads the open sessions and their busy state, asks `sessionsToRetire` which to close, and
 * closes them. The part before the first `await` is one synchronous step: the idle check of each
 * session and the start of its close have no `await` between (rule 6), so a message cannot slip in
 * and a card that shows is never closed. The promise resolves when the closes that it started have ended.
 * It never rejects.
 */
export async function retireIdleHandler(deps: RetireIdleDeps): Promise<void> {
  const { processes, clock, limits, log } = deps
  const closes: Promise<void>[] = []
  try {
    for (const id of sessionsToRetire(openSessionsOf(deps), clock.now(), limits)) {
      // Rule 6: check again right before the close. Nothing runs between this check and the close.
      if (busy(deps, id)) continue
      const closed = processes.retire(id)
      if (closed) closes.push(closed.catch((cause: unknown) => log(`The close of the idle agent of session ${id} failed.`, cause)))
    }
  } catch (cause) {
    log('The release of idle agents failed.', cause)
  }
  await Promise.all(closes)
}

/** Whether a turn runs, or the session shows a status other than idle. A session that starts has a turn. */
const inTurn = ({ processes, transcript }: RetireIdleDeps, id: string): boolean => processes.turnOf(id) !== undefined || transcript.statusOf(id) !== 'idle'

// A caller that passes no count (a test of an earlier story) has no open card.
const requestsOf = ({ openRequests }: RetireIdleDeps, id: string): number => (typeof openRequests === 'function' ? openRequests(id) : 0)

const busy = (deps: RetireIdleDeps, id: string): boolean => inTurn(deps, id) || requestsOf(deps, id) > 0

/** Each session with an open process and its busy state. A session that Aether cannot read is logged and skipped. */
function openSessionsOf(deps: RetireIdleDeps): OpenSession[] {
  const { store, processes, log } = deps
  const open: OpenSession[] = []
  for (const id of processes.openSessions()) {
    try {
      const startedBy = store.startedByOf(id)
      // A deleted session has no row. The delete closes its process, so there is nothing to release.
      if (startedBy === null) continue
      open.push({
        id,
        startedBy,
        idleSince: busy(deps, id) ? null : processes.idleSince(id),
        turn: inTurn(deps, id),
        openRequests: requestsOf(deps, id)
      })
    } catch (cause) {
      log(`Aether could not read the session ${id}, so it does not release its agent.`, cause)
    }
  }
  return open
}
