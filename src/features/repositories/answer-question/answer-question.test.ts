import { describe, expect, it } from 'vitest'
import type { NewQuestion } from '../question'
import { Questions } from '../questions.store'
import { answerQuestion } from './answer-question.contract'
import { answerQuestionHandler } from './answer-question.handler'

const found = { hooks: [], mcpServers: [], files: [], unreadable: [] }
const trust: NewQuestion = { kind: 'trust', sessionId: 's1', profileName: 'Personal', folder: 'C:\\r\\repo-b', repository: 'repo-b', repositoryRoot: 'C:\\r\\repo-b', holdsWorkspace: false, workspaceDirectory: 'C:\\r', ...found }

const setup = () => {
  const questions = new Questions(() => undefined, { next: () => 'q1' })
  return { questions, deps: { questions } }
}

describe('contract', () => {
  it('accepts its valid examples and rejects its invalid ones', () => {
    for (const example of answerQuestion.examples.valid) expect(answerQuestion.input.safeParse(example).success).toBe(true)
    for (const example of answerQuestion.examples.invalid) expect(answerQuestion.input.safeParse(example).success).toBe(false)
  })
})

describe('answerQuestionHandler', () => {
  it('gives the answer to the turn that waits', async () => {
    const { questions, deps } = setup()
    const waiting = questions.ask(trust)
    expect(answerQuestionHandler(deps, { sessionId: 's1', questionId: 'q1', answer: 'trust' })).toEqual({ ok: true, value: {} })
    expect(await waiting).toBe('trust')
  })

  it('refuses an answer that the question does not offer, and keeps the question open', () => {
    const { questions, deps } = setup()
    void questions.ask(trust)
    const result = answerQuestionHandler(deps, { sessionId: 's1', questionId: 'q1', answer: 'allow-always' })
    expect(result).toMatchObject({ ok: false, error: { code: 'answer-not-offered' } })
    expect(questions.snapshot().questions).toHaveLength(1)
  })

  it('returns unknown-question for a closed question and for a session that does not own it', () => {
    const { questions, deps } = setup()
    void questions.ask(trust)
    expect(answerQuestionHandler(deps, { sessionId: 'other', questionId: 'q1', answer: 'trust' })).toMatchObject({ ok: false, error: { code: 'unknown-question' } })
    expect(answerQuestionHandler(deps, { sessionId: 's1', questionId: 'q1', answer: 'cancel' }).ok).toBe(true)
    expect(answerQuestionHandler(deps, { sessionId: 's1', questionId: 'q1', answer: 'cancel' })).toMatchObject({ ok: false, error: { code: 'unknown-question' } })
  })
})
