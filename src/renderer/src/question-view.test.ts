import { describe, expect, it } from 'vitest'
import type { Question, QuestionEvent } from '../../features/repositories/list-questions/list-questions.contract'
import { emptyQuestionsState, reduceQuestions, type QuestionsAction, type QuestionsState } from './question-view'

const found = { hooks: [], mcpServers: [], unreadable: [] }
const question = (id: string, sessionId = 's1'): Question => ({ kind: 'outside', id, sessionId, profileName: 'Personal', folder: 'C:\\x', ...found })
const opened = (revision: number, id: string): QuestionEvent => ({ revision, change: { type: 'opened', question: question(id) } })
const closed = (revision: number, id: string): QuestionEvent => ({ revision, change: { type: 'closed', id } })
const run = (actions: QuestionsAction[], from: QuestionsState = emptyQuestionsState) => actions.reduce(reduceQuestions, from)
const ids = (state: QuestionsState) => state.questions.map((item) => item.id)

describe('reduceQuestions', () => {
  it('takes the snapshot, then applies the next revisions in order', () => {
    const state = run([
      { type: 'snapshot', snapshot: { revision: 1, questions: [question('q1')] } },
      { type: 'event', event: opened(2, 'q2') },
      { type: 'event', event: closed(3, 'q1') }
    ])
    expect(ids(state)).toEqual(['q2'])
    expect(state).toMatchObject({ revision: 3, needsSnapshot: false })
  })

  it('keeps an event that comes before the first snapshot, and applies those after it', () => {
    const state = run([
      { type: 'event', event: opened(3, 'q3') },
      { type: 'event', event: opened(2, 'q2') },
      { type: 'event', event: opened(1, 'q1') },
      { type: 'snapshot', snapshot: { revision: 1, questions: [question('q1')] } }
    ])
    expect(ids(state)).toEqual(['q1', 'q2', 'q3'])
    expect(state.revision).toBe(3)
  })

  it('drops the events at or below the revision of the snapshot', () => {
    const state = run([
      { type: 'event', event: opened(1, 'q1') },
      { type: 'event', event: closed(2, 'q1') },
      { type: 'snapshot', snapshot: { revision: 2, questions: [] } }
    ])
    expect(state).toMatchObject({ revision: 2, questions: [] })
  })

  it('asks for a new snapshot at a gap in the revisions', () => {
    const state = run([
      { type: 'snapshot', snapshot: { revision: 1, questions: [question('q1')] } },
      { type: 'event', event: opened(3, 'q3') }
    ])
    expect(state.needsSnapshot).toBe(true)
    expect(ids(state)).toEqual(['q1'])
    const healed = reduceQuestions(state, { type: 'snapshot', snapshot: { revision: 3, questions: [question('q1'), question('q3')] } })
    expect(healed).toMatchObject({ needsSnapshot: false, revision: 3 })
  })

  it('ignores an old event and a stale snapshot', () => {
    const start = run([{ type: 'snapshot', snapshot: { revision: 2, questions: [question('q2')] } }])
    expect(run([{ type: 'event', event: opened(2, 'q2') }], start)).toEqual(start)
    expect(run([{ type: 'snapshot', snapshot: { revision: 1, questions: [] } }], start)).toMatchObject({ revision: 2, questions: [question('q2')] })
  })

  it('opens a question once, also when the same event comes twice after a snapshot', () => {
    const start = run([{ type: 'snapshot', snapshot: { revision: 0, questions: [] } }])
    expect(ids(run([{ type: 'event', event: opened(1, 'q1') }, { type: 'event', event: opened(1, 'q1') }], start))).toEqual(['q1'])
  })
})
