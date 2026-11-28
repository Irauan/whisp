import { err, ok, type Result } from '../../../building-blocks/result'
import { isDraft } from '../entry'
import { MESSAGES } from '../session'
import type { SessionStore } from '../session.store'
import type { Transcript } from '../transcript.store'
import type { SetModelError } from './set-model.contract'

export interface SetModelDeps {
  store: SessionStore
  transcript: Transcript
}

/** Saves the model of a draft. A session that has an entry, an agent session or a turn keeps its model. */
export function setModelHandler(
  { store, transcript }: SetModelDeps,
  { id, model }: { id: string; model: string }
): Result<Record<string, never>, SetModelError> {
  if (!store.find(id)) return err('unknown-session', MESSAGES.unknownSession)
  const agentSessionId = store.agentRunOf(id)?.externalId ?? null
  const draft = isDraft({ entryCount: store.entryCount(id), agentSessionId, status: transcript.statusOf(id) })
  if (!draft) return err('session-started', MESSAGES.sessionStarted)
  store.setModel(id, model)
  return ok({})
}
