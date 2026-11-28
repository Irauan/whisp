import { err, ok, type Result } from '../../../building-blocks/result'
import { closedWithout } from '../cards'
import type { Processes } from '../processes.store'
import { MESSAGES } from '../session'
import type { SessionStore } from '../session.store'
import type { Transcript } from '../transcript.store'
import type { StopSessionError } from './stop.contract'

export interface StopDeps {
  store: SessionStore
  transcript: Transcript
  processes: Processes
}

/**
 * Stops the turn of a session. It marks the turn, so that a turn that has no process yet ends
 * before it starts one. It then asks the process to cancel: a process that is not ready ends its
 * start, and a process in a turn cancels the turn. The turn writes "Stopped." and settles the tool calls.
 * An open card closes with the reason `stopped`, saved before the cancel, so that the cancel of the
 * process, and a withdraw that follows it, change nothing (spec S5). A request outside a turn is
 * cancelled the same way: Stop with no turn but with an open card still stops.
 */
export function stopHandler({ store, transcript, processes }: StopDeps, { id }: { id: string }): Result<Record<string, never>, StopSessionError> {
  if (!store.find(id)) return err('unknown-session', MESSAGES.unknownSession)
  if (transcript.statusOf(id) === 'idle' && transcript.openCardCount(id) === 0) return ok({})
  const turn = processes.turnOf(id)
  if (turn) turn.stopped = true
  transcript.closeAllCards(id, (card) => closedWithout(card.entry, 'stopped'))
  // `cancel` never rejects.
  void processes.get(id)?.cancel()
  return ok({})
}
