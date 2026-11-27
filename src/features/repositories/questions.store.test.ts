import { describe, expect, it } from 'vitest'
import type { NewQuestion, QuestionEvent } from './question'
import { Questions } from './questions.store'

const found = { hooks: [], mcpServers: [], unreadable: [] }
const trust = (sessionId: string): NewQuestion => ({ kind: 'trust', sessionId, profileName: 'Personal', folder: 'C:\\r\\repo-b', repository: 'repo-b', ...found })
const outside = (sessionId: string): NewQuestion => ({ kind: 'outside', sessionId, profileName: 'Personal', folder: 'C:\\x', ...found })

function setup() {
  const events: QuestionEvent[] = []
  let count = 0
  const questions = new Questions((event) => events.push(event), { next: () => `q${++count}` })
  return { questions, events }
}

describe('Questions', () => {
  it('opens a question with its own ID and a revision, oldest first', () => {
    const { questions, events } = setup()
    void questions.ask(trust('s1'))
    void questions.ask(outside('s2'))
    expect(questions.snapshot().revision).toBe(2)
    expect(questions.snapshot().questions.map(({ id, sessionId }) => [id, sessionId])).toEqual([
      ['q1', 's1'],
      ['q2', 's2']
    ])
    expect(events.map((event) => [event.revision, event.change.type])).toEqual([
      [1, 'opened'],
      [2, 'opened']
    ])
  })

  it('resolves the asking turn with the answer and closes the question', async () => {
    const { questions, events } = setup()
    const answer = questions.ask(trust('s1'))
    expect(questions.answer('s1', 'q1', 'trust')).toBe('answered')
    expect(await answer).toBe('trust')
    expect(questions.snapshot()).toEqual({ revision: 2, questions: [] })
    expect(events.at(-1)).toEqual({ revision: 2, change: { type: 'closed', id: 'q1' } })
  })

  it('refuses an answer that the kind does not offer, and keeps the question open', () => {
    const { questions } = setup()
    void questions.ask(trust('s1'))
    void questions.ask(outside('s2'))
    expect(questions.answer('s1', 'q1', 'allow-always')).toBe('not-offered')
    expect(questions.answer('s2', 'q2', 'trust')).toBe('not-offered')
    expect(questions.snapshot().questions).toHaveLength(2)
  })

  it('ignores an answer for an unknown question, a stale one, and one for another session', () => {
    const { questions } = setup()
    void questions.ask(trust('s1'))
    expect(questions.answer('s1', 'nope', 'cancel')).toBe('unknown')
    expect(questions.answer('s2', 'q1', 'trust')).toBe('unknown')
    expect(questions.answer('s1', 'q1', 'cancel')).toBe('answered')
    expect(questions.answer('s1', 'q1', 'trust')).toBe('unknown')
  })

  it('cancels only the questions of one session', async () => {
    const { questions } = setup()
    const first = questions.ask(trust('s1'))
    void questions.ask(outside('s2'))
    questions.cancelSession('s1')
    expect(await first).toBe('cancel')
    expect(questions.snapshot().questions.map((question) => question.sessionId)).toEqual(['s2'])
  })

  it('cancels all questions, so that a quit never waits for an answer', async () => {
    const { questions } = setup()
    const all = Promise.all([questions.ask(trust('s1')), questions.ask(outside('s2'))])
    questions.cancelAll()
    expect(await all).toEqual(['cancel', 'cancel'])
    expect(questions.snapshot().questions).toEqual([])
  })
})
