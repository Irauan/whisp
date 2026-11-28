import { err, ok, type Result } from '../../../building-blocks/result'
import { answeredDecision } from '../cards'
import type { Processes } from '../processes.store'
import { MESSAGES } from '../session'
import type { SessionStore } from '../session.store'
import type { Transcript } from '../transcript.store'
import type { AnswerPermissionError } from './answer-permission.contract'

export interface AnswerPermissionDeps {
  store: SessionStore
  transcript: Transcript
  processes: Processes
}

export const PERMISSION_MESSAGES = {
  unknownRequest: 'This permission request is closed.',
  unknownOption: 'Aether cannot send this answer.'
} as const

/**
 * Answers one open permission request. The main process checks the session, the request and the
 * option before it tells the agent, so the renderer can answer only what the agent asked and offered.
 * The agent gets the answer for that request only. The card then closes: its `answers` entry becomes
 * "submitted", with the label of the option, and the open request leaves the queue.
 */
export function answerPermissionHandler(
  { store, transcript, processes }: AnswerPermissionDeps,
  { id, requestId, optionId }: { id: string; requestId: string; optionId: string }
): Result<Record<string, never>, AnswerPermissionError> {
  if (!store.find(id)) return err('unknown-session', MESSAGES.unknownSession)
  const card = transcript.findCard(id, requestId)
  const agent = processes.get(id)
  if (card?.kind !== 'permission' || !agent) return err('unknown-request', PERMISSION_MESSAGES.unknownRequest)
  const option = card.view.options.find((item) => item.id === optionId)
  if (!option) return err('unknown-option', PERMISSION_MESSAGES.unknownOption)
  const sent = agent.answer(requestId, optionId)
  if (!sent.ok) {
    return sent.error.code === 'unknown-option'
      ? err('unknown-option', PERMISSION_MESSAGES.unknownOption)
      : err('unknown-request', PERMISSION_MESSAGES.unknownRequest)
  }
  transcript.closeCard(id, requestId, (open) => answeredDecision(open.entry, option.label))
  return ok({})
}
