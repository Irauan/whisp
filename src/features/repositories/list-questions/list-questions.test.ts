import { describe, expect, it } from 'vitest'
import type { QuestionEvent } from '../question'
import { Questions } from '../questions.store'
import { listQuestions, questionEventSchema } from './list-questions.contract'
import { listQuestionsController } from './list-questions.controller'

const found = { hooks: [{ event: 'SessionStart', command: 'node a.js' }], mcpServers: [], unreadable: [] }

describe('contract', () => {
  it('accepts its valid examples and rejects its invalid ones', () => {
    for (const example of listQuestions.examples.valid) expect(listQuestions.input.safeParse(example).success).toBe(true)
    for (const example of listQuestions.examples.invalid) expect(listQuestions.input.safeParse(example).success).toBe(false)
  })
})

describe('listQuestionsController', () => {
  it('returns a snapshot that the contract accepts, with the revision that matches the events', async () => {
    const events: QuestionEvent[] = []
    const questions = new Questions((event) => events.push(event), { next: () => 'q1' })
    void questions.ask({ kind: 'trust', sessionId: 's1', profileName: 'Personal', folder: 'C:\\r\\repo-b', repository: 'repo-b', ...found })
    const snapshot = await listQuestionsController(questions)()
    expect(listQuestions.output.safeParse(snapshot).success).toBe(true)
    expect(snapshot).toMatchObject({ ok: true, value: { revision: 1, questions: [{ id: 'q1', kind: 'trust' }] } })
    for (const event of events) expect(questionEventSchema.safeParse(event).success).toBe(true)
  })

  it('starts with revision 0 and no question', async () => {
    const questions = new Questions(() => undefined, { next: () => 'q1' })
    expect(await listQuestionsController(questions)()).toEqual({ ok: true, value: { revision: 0, questions: [] } })
  })
})
