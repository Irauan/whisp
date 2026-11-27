import { err, ok, type Result } from '../../../building-blocks/result'
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
 */
export function stopHandler({ store, transcript, processes }: StopDeps, { id }: { id: string }): Result<Record<string, never>, StopSessionError> {
  if (!store.find(id)) return err('unknown-session', MESSAGES.unknownSession)
  if (transcript.statusOf(id) === 'idle') return ok({})
  const turn = processes.turnOf(id)
  if (turn) turn.stopped = true
  // `cancel` never rejects.
  void processes.get(id)?.cancel()
  return ok({})
}
