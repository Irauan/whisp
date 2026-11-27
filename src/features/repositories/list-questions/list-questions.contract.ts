import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'
import { QUESTIONS_CHANGED, questionEventSchema, questionSchema, type Question, type QuestionEvent } from '../question'

// The renderer imports only contracts, so the contract of the query carries the questions and their event.
export { QUESTIONS_CHANGED, questionEventSchema, type Question, type QuestionEvent }

/**
 * The open questions of the main process, oldest first, with a revision (decision 0002). The renderer
 * subscribes to the event `repositories.questions-changed` first, then calls this query, drops the
 * events at or below the revision of the snapshot, and loads a new snapshot when it sees a gap.
 */
export const listQuestions = defineContract(
  'repositories.list-questions',
  z.strictObject({}),
  z.strictObject({ revision: z.number().int().min(0), questions: z.array(questionSchema) }),
  [],
  {
    valid: [{}],
    invalid: [null, { id: 's1' }, 'all']
  }
)
