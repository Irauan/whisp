import { describe, expect, it } from 'vitest'
import type { Elicitation, ElicitationField, PermissionRequest } from '../../building-blocks/agent.port'
import { answeredDecision, answeredQuestion, closedWithout, decisionQuestion, openDecision, openQuestion, permissionView, questionsOf } from './cards'
import { entrySchema, type AnswersEntry } from './entry'

const request: PermissionRequest = {
  id: 'r1',
  toolId: 't1',
  title: 'npm test',
  toolKind: 'execute',
  locations: [],
  options: [{ id: 'yes', label: 'Yes', kind: 'allow-once' }]
}

describe('decisionQuestion', () => {
  it.each([
    ['execute', 'Run this command?'],
    ['edit', 'Make this change?'],
    ['delete', 'Make this change?'],
    ['move', 'Make this change?'],
    ['read', 'Read this?'],
    ['search', 'Read this?'],
    ['fetch', 'Fetch this?'],
    ['switch_mode', 'Approve the plan?'],
    ['think', 'Allow this tool?'],
    ['other', 'Allow this tool?'],
    [null, 'Allow this tool?']
  ])('asks for the tool kind %s: "%s"', (kind, question) => {
    expect(decisionQuestion(kind)).toBe(question)
  })
})

describe('permissionView', () => {
  it('uses the request first, then the announced call, then the defaults', () => {
    expect(permissionView(request, 'e1', { title: 'Other', toolKind: 'read' })).toMatchObject({ id: 'r1', entryId: 'e1', title: 'npm test', toolKind: 'execute' })
    const bare = { ...request, title: null, toolKind: null }
    expect(permissionView(bare, 'e1', { title: 'Run the tests', toolKind: 'execute' })).toMatchObject({ title: 'Run the tests', toolKind: 'execute' })
    expect(permissionView(bare, 'e1', null)).toMatchObject({ title: 'Tool call', toolKind: null })
  })
})

describe('the entries of a decision card', () => {
  const open = openDecision({ toolId: 't1', toolKind: 'execute' })

  it('opens with one row: the question and no answer', () => {
    expect(open).toEqual({ kind: 'answers', card: 'decision', toolId: 't1', outcome: 'open', rows: [{ question: 'Run this command?', answer: null }] })
    expect(entrySchema.parse(open)).toEqual(open)
  })

  it('keeps the question and saves the label of the answer, or the reason of a close', () => {
    expect(answeredDecision(open, 'Yes')).toMatchObject({ outcome: 'submitted', rows: [{ question: 'Run this command?', answer: 'Yes' }] })
    expect(closedWithout(open, 'stopped')).toMatchObject({ outcome: 'stopped', rows: [{ question: 'Run this command?', answer: null }] })
  })
})

const single: ElicitationField = {
  key: 'question_0',
  kind: 'choice',
  title: 'Runner',
  description: null,
  options: [
    { value: 'Vitest', label: 'Vitest (Recommended)', description: 'Fast.' },
    { value: 'Jest', label: 'Jest', description: null }
  ]
}
const custom: ElicitationField = { key: 'question_0_custom', kind: 'text', title: 'Other', description: null, completes: 'question_0' }
const multi: ElicitationField = {
  key: 'question_1',
  kind: 'choices',
  title: 'Reports',
  description: 'Which reports do you want?',
  options: [
    { value: 'Coverage', label: 'Coverage', description: null },
    { value: 'JUnit', label: 'JUnit XML', description: null },
    { value: 'HTML', label: 'HTML', description: null }
  ]
}
const customTwo: ElicitationField = { key: 'question_1_custom', kind: 'text', title: 'Other', description: null, completes: 'question_1' }

const oneQuestion: Pick<Elicitation, 'toolId' | 'message' | 'fields'> = { toolId: 'a1', message: 'Which test runner do you want?', fields: [single, custom] }
const twoQuestions: Pick<Elicitation, 'toolId' | 'message' | 'fields'> = {
  toolId: 'a1',
  message: 'Please answer the following questions.',
  fields: [{ ...single, description: 'Which test runner do you want?' }, custom, multi, customTwo]
}

describe('the entries of a question card', () => {
  it('opens with one row for each question, and no row for a text that completes a choice', () => {
    expect(questionsOf(twoQuestions.fields).map((field) => field.key)).toEqual(['question_0', 'question_1'])
    expect(openQuestion(oneQuestion)).toEqual({
      kind: 'answers',
      card: 'question',
      toolId: 'a1',
      outcome: 'open',
      rows: [{ question: 'Which test runner do you want?', answer: null }]
    })
  })

  it('takes the question of a form with several questions from the description of the field, and falls back to the title', () => {
    expect(openQuestion(twoQuestions).rows.map((row) => row.question)).toEqual(['Which test runner do you want?', 'Which reports do you want?'])
    expect(openQuestion({ ...twoQuestions, fields: [single, custom, { ...multi, description: null }, customTwo] }).rows.map((row) => row.question)).toEqual([
      'Runner',
      'Reports'
    ])
  })

  it('saves the picked labels, then the typed text, joined with ", "', () => {
    const entry: AnswersEntry = openQuestion(twoQuestions)
    const answered = answeredQuestion(entry, { fields: twoQuestions.fields, keepsText: true }, {
      action: 'submit',
      values: { question_0: 'Vitest', question_1: ['Coverage', 'HTML'], question_1_custom: ' A summary ' }
    })
    expect(answered.outcome).toBe('submitted')
    expect(answered.rows.map((row) => row.answer)).toEqual(['Vitest (Recommended)', 'Coverage, HTML, A summary'])
  })

  it('saves no answer for a question with no pick and no text', () => {
    const answered = answeredQuestion(openQuestion(twoQuestions), { fields: twoQuestions.fields, keepsText: true }, { action: 'submit', values: { question_0: 'Jest' } })
    expect(answered.rows.map((row) => row.answer)).toEqual(['Jest', null])
  })

  it('saves "Answered" in place of the typed text of a form that can hold a secret, and still the labels of the picks', () => {
    const answered = answeredQuestion(openQuestion(oneQuestion), { fields: oneQuestion.fields, keepsText: false }, { action: 'submit', values: { question_0: 'Jest', question_0_custom: 'a secret' } })
    expect(answered.rows.map((row) => row.answer)).toEqual(['Jest, Answered'])
    const text: Pick<Elicitation, 'toolId' | 'message' | 'fields'> = {
      toolId: null,
      message: 'The example service needs a token.',
      fields: [{ key: 'token', kind: 'text', title: 'Token', description: 'Paste it.', completes: null }]
    }
    expect(answeredQuestion(openQuestion(text), { fields: text.fields, keepsText: false }, { action: 'submit', values: { token: 'fake-secret' } }).rows).toEqual([
      { question: 'The example service needs a token.', answer: 'Answered' }
    ])
  })

  it('closes a skipped form with the outcome skipped and no answer in any row', () => {
    const skipped = answeredQuestion(openQuestion(twoQuestions), { fields: twoQuestions.fields, keepsText: true }, { action: 'skip' })
    expect(skipped.outcome).toBe('skipped')
    expect(skipped.rows.map((row) => row.answer)).toEqual([null, null])
  })
})
