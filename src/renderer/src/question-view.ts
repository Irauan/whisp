import type { Question, QuestionEvent } from '../../features/repositories/list-questions/list-questions.contract'

/** The view state of the open questions. The main process owns the data (decision 0002). */
export interface QuestionsState {
  /** The revision of the last snapshot with the events applied to it. Null before the first snapshot. */
  revision: number | null
  /** The open questions, oldest first. */
  questions: Question[]
  /** Events that came before the first snapshot. They apply after it. */
  pending: QuestionEvent[]
  /** True when an event did not fit: the view must load a new snapshot. */
  needsSnapshot: boolean
}

export type QuestionsAction =
  | { type: 'snapshot'; snapshot: { revision: number; questions: Question[] } }
  | { type: 'event'; event: QuestionEvent }

export const emptyQuestionsState: QuestionsState = { revision: null, questions: [], pending: [], needsSnapshot: false }

function applyEvent(state: QuestionsState, revision: number, event: QuestionEvent): QuestionsState {
  if (event.revision <= revision) return state
  if (event.revision !== revision + 1) return { ...state, pending: [], needsSnapshot: true }
  const { change } = event
  const questions =
    change.type === 'opened'
      ? [...state.questions.filter((question) => question.id !== change.question.id), change.question]
      : state.questions.filter((question) => question.id !== change.id)
  return { ...state, revision: event.revision, questions }
}

/**
 * Applies a snapshot or an event, in the order of the revision (architecture, State). An old event
 * changes nothing. The next revision applies. A later revision is a gap: the view asks for a new snapshot.
 */
export function reduceQuestions(state: QuestionsState, action: QuestionsAction): QuestionsState {
  if (action.type === 'event') {
    if (state.revision === null) return { ...state, pending: [...state.pending, action.event] }
    return applyEvent(state, state.revision, action.event)
  }
  // A snapshot that is older than the view is stale: a newer load already answered.
  if (state.revision !== null && action.snapshot.revision < state.revision) return { ...state, needsSnapshot: false }
  let next: QuestionsState = { revision: action.snapshot.revision, questions: action.snapshot.questions, pending: [], needsSnapshot: false }
  for (const event of state.pending.toSorted((a, b) => a.revision - b.revision)) {
    if (next.revision === null || next.needsSnapshot) break
    next = applyEvent(next, next.revision, event)
  }
  return next
}
