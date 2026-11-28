import type { ElicitationAnswer } from '../../../building-blocks/agent.port'
import { fitsFields } from '../../../building-blocks/elicitation'
import { err, ok, type Result } from '../../../building-blocks/result'
import { answeredQuestion } from '../cards'
import type { Processes } from '../processes.store'
import { MESSAGES } from '../session'
import type { SessionStore } from '../session.store'
import type { Transcript } from '../transcript.store'
import type { AnswerElicitationError } from './answer-elicitation.contract'

export interface AnswerElicitationDeps {
  store: SessionStore
  transcript: Transcript
  processes: Processes
}

export const ELICITATION_MESSAGES = {
  unknownRequest: 'This question of Claude is closed.',
  invalidAnswer: 'Aether cannot send this answer.'
} as const

/**
 * Answers one open form. The main process checks the session, the form and each value before it tells
 * the agent. A skip sends "decline". The card then closes and its `answers` entry holds what the user
 * answered: the picked labels and the typed text, or "Answered" for a form that can hold a secret.
 */
export function answerElicitationHandler(
  { store, transcript, processes }: AnswerElicitationDeps,
  { id, elicitationId, answer }: { id: string; elicitationId: string; answer: ElicitationAnswer }
): Result<Record<string, never>, AnswerElicitationError> {
  if (!store.find(id)) return err('unknown-session', MESSAGES.unknownSession)
  const card = transcript.findCard(id, elicitationId)
  const agent = processes.get(id)
  if (card?.kind !== 'elicitation' || !agent) return err('unknown-request', ELICITATION_MESSAGES.unknownRequest)
  if (!fitsFields(card.view.fields, answer)) return err('invalid-answer', ELICITATION_MESSAGES.invalidAnswer)
  const sent = agent.answerElicitation(elicitationId, answer)
  if (!sent.ok) {
    return sent.error.code === 'invalid-answer'
      ? err('invalid-answer', ELICITATION_MESSAGES.invalidAnswer)
      : err('unknown-request', ELICITATION_MESSAGES.unknownRequest)
  }
  transcript.closeCard(id, elicitationId, (open) =>
    open.kind === 'elicitation' ? answeredQuestion(open.entry, { fields: open.view.fields, keepsText: open.keepsText }, answer) : open.entry
  )
  return ok({})
}
