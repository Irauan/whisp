import type { Mode } from '../../../building-blocks/mode'
import { err, ok, type Result } from '../../../building-blocks/result'
import { isDraft } from '../entry'
import { MESSAGES } from '../session'
import type { SessionStore } from '../session.store'
import type { Transcript } from '../transcript.store'
import type { SetModeError } from './set-mode.contract'

export interface SetModeDeps {
  store: SessionStore
  transcript: Transcript
}

/** Saves the mode of a draft. A session that has an entry, an agent session or a turn keeps its mode. */
export function setModeHandler(
  { store, transcript }: SetModeDeps,
  { id, mode }: { id: string; mode: Mode }
): Result<Record<string, never>, SetModeError> {
  if (!store.find(id)) return err('unknown-session', MESSAGES.unknownSession)
  const agentSessionId = store.agentRunOf(id)?.externalId ?? null
  const draft = isDraft({ entryCount: store.entryCount(id), agentSessionId, status: transcript.statusOf(id) })
  if (!draft) return err('session-started', MESSAGES.sessionStarted)
  store.setMode(id, mode)
  return ok({})
}
