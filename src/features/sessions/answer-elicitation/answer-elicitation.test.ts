import { describe, expect, it } from 'vitest'
import type { AgentProcess, Elicitation, ElicitationAnswer } from '../../../building-blocks/agent.port'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { err, ok } from '../../../building-blocks/result'
import { Processes } from '../processes.store'
import { SessionStore } from '../session.store'
import { Transcript } from '../transcript.store'
import { answerElicitation } from './answer-elicitation.contract'
import { answerElicitationHandler } from './answer-elicitation.handler'

const form: Elicitation = {
  id: 'f1',
  toolId: 'a1',
  message: 'Which test runner do you want?',
  fields: [
    {
      key: 'question_0',
      kind: 'choice',
      title: 'Runner',
      description: null,
      options: [
        { value: 'Vitest', label: 'Vitest (Recommended)', description: 'Fast.' },
        { value: 'Jest', label: 'Jest', description: null }
      ]
    },
    { key: 'question_0_custom', kind: 'text', title: 'Other', description: null, completes: 'question_0' }
  ],
  recommended: null,
  keepsText: true
}

function setup(opening: Elicitation = form) {
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  const { database } = opened.value
  database.prepare("INSERT INTO profiles (id, name, created_at) VALUES ('p1', 'Personal', '2026-01-01')").run()
  database
    .prepare(
      "INSERT INTO sessions (id, profile_id, title, prompt, mode, source_path, model, created_at) VALUES ('s1', 'p1', 't', 'p', 'ask', 'C:\\work', 'default', '2026-01-01')"
    )
    .run()
  const store = new SessionStore(database)
  let count = 0
  const transcript = new Transcript(store, () => undefined, { now: () => new Date('2026-01-02T00:00:00.000Z') }, { next: () => `e${++count}` })
  const processes = new Processes()
  const sent: [string, ElicitationAnswer][] = []
  const process: AgentProcess = {
    ready: Promise.resolve(ok({ agentSessionId: 'a1', resumed: false, resumeError: null })),
    prompt: () => new Promise(() => undefined),
    cancel: () => Promise.resolve(),
    close: () => Promise.resolve(),
    answer: () => err('unknown-request', 'x'),
    answerElicitation: (id, answer) => {
      sent.push([id, answer])
      return ok(true)
    }
  }
  processes.set('s1', process)
  transcript.openElicitation('s1', opening)
  return { store, transcript, sent, answer: (input: { id: string; elicitationId: string; answer: ElicitationAnswer }) => answerElicitationHandler({ store, transcript, processes }, input) }
}

describe('sessions.answer-elicitation', () => {
  it('sends the picks to the agent, closes the card and saves the labels and the typed text', () => {
    const { store, transcript, sent, answer } = setup()
    const input = { id: 's1', elicitationId: 'f1', answer: { action: 'submit', values: { question_0: 'Vitest', question_0_custom: 'for the parser' } } } as const
    const result = answer(input)
    expect(result).toEqual({ ok: true, value: {} })
    expect(answerElicitation.output.safeParse(result).success).toBe(true)
    expect(sent).toEqual([['f1', input.answer]])
    expect(transcript.openCardCount('s1')).toBe(0)
    expect(store.entriesOf('s1')[0]?.entry).toEqual({
      kind: 'answers',
      card: 'question',
      toolId: 'a1',
      outcome: 'submitted',
      rows: [{ question: 'Which test runner do you want?', answer: 'Vitest (Recommended), for the parser' }]
    })
  })

  it('saves the outcome skipped for a skip, with no answer in the row', () => {
    const { store, sent, answer } = setup()
    expect(answer({ id: 's1', elicitationId: 'f1', answer: { action: 'skip' } }).ok).toBe(true)
    expect(sent).toEqual([['f1', { action: 'skip' }]])
    expect(store.entriesOf('s1')[0]?.entry).toMatchObject({ outcome: 'skipped', rows: [{ answer: null }] })
  })

  it('refuses a value that the form did not offer, a key that no field has and a wrong type, and sends nothing', () => {
    const { transcript, sent, answer } = setup()
    const wrong: Record<string, string | string[]>[] = [{ question_0: 'Mocha' }, { other: 'x' }, { question_0: ['Jest'] }, { question_0_custom: ['x'] }]
    for (const values of wrong) {
      expect(answer({ id: 's1', elicitationId: 'f1', answer: { action: 'submit', values } })).toMatchObject({
        ok: false,
        error: { code: 'invalid-answer', message: 'Aether cannot send this answer.' }
      })
    }
    expect(sent).toEqual([])
    expect(transcript.openCardCount('s1')).toBe(1)
  })

  it('refuses an unknown session, an unknown form and the ID of a permission request', () => {
    const { transcript, answer } = setup()
    transcript.openPermission('s1', { id: 'r1', toolId: 't1', title: null, toolKind: null, locations: [], options: [] })
    expect(answer({ id: 'nope', elicitationId: 'f1', answer: { action: 'skip' } })).toMatchObject({ ok: false, error: { code: 'unknown-session' } })
    expect(answer({ id: 's1', elicitationId: 'nope', answer: { action: 'skip' } })).toMatchObject({
      ok: false,
      error: { code: 'unknown-request', message: 'This question of Claude is closed.' }
    })
    expect(answer({ id: 's1', elicitationId: 'r1', answer: { action: 'skip' } })).toMatchObject({ ok: false, error: { code: 'unknown-request' } })
  })

  it('saves "Answered" for the text of a form that cannot keep its text', () => {
    const secret: Elicitation = {
      id: 'f2',
      toolId: null,
      message: 'The example service needs a token.',
      fields: [{ key: 'token', kind: 'text', title: 'Token', description: null, completes: null }],
      recommended: null,
      keepsText: false
    }
    const { store, answer } = setup(secret)
    expect(answer({ id: 's1', elicitationId: 'f2', answer: { action: 'submit', values: { token: 'fake-secret-value' } } }).ok).toBe(true)
    expect(JSON.stringify(store.entriesOf('s1'))).not.toContain('fake-secret-value')
    expect(store.entriesOf('s1')[0]?.entry).toMatchObject({ rows: [{ answer: 'Answered' }] })
  })
})
