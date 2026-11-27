import { describe, expect, it } from 'vitest'
import type { AgentProcess, PermissionRequest } from '../../../building-blocks/agent.port'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { err, ok } from '../../../building-blocks/result'
import type { SessionEvent } from '../entry'
import { Processes } from '../processes.store'
import { SessionStore } from '../session.store'
import { Transcript } from '../transcript.store'
import { answerPermission } from './answer-permission.contract'
import { answerPermissionHandler } from './answer-permission.handler'

const request: PermissionRequest = {
  id: 'r1',
  toolId: 't1',
  title: 'npm test',
  toolKind: 'execute',
  locations: [],
  options: [
    { id: 'yes', label: 'Yes', kind: 'allow-once' },
    { id: 'no', label: 'No', kind: 'refuse-once' }
  ]
}

function setup() {
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
  const events: SessionEvent[] = []
  let count = 0
  const transcript = new Transcript(store, (event) => events.push(event), { now: () => new Date('2026-01-02T00:00:00.000Z') }, { next: () => `e${++count}` })
  const processes = new Processes()
  const answered: [string, string][] = []
  // The process refuses an option that it does not know, as the provider does.
  const process: AgentProcess = {
    ready: Promise.resolve(ok({ agentSessionId: 'a1', resumed: false, resumeError: null })),
    prompt: () => new Promise(() => undefined),
    cancel: () => Promise.resolve(),
    close: () => Promise.resolve(),
    answer: (requestId, optionId) => {
      if (optionId !== 'yes' && optionId !== 'no') return err('unknown-option', 'x')
      answered.push([requestId, optionId])
      return ok(true)
    },
    answerElicitation: () => err('unknown-request', 'x')
  }
  processes.set('s1', process)
  transcript.openPermission('s1', request)
  events.length = 0
  return { store, transcript, processes, events, answered, answer: (input: { id: string; requestId: string; optionId: string }) => answerPermissionHandler({ store, transcript, processes }, input) }
}

describe('sessions.answer-permission', () => {
  it('answers the request for the agent, closes the card and saves the label of the option', () => {
    const { store, transcript, events, answered, answer } = setup()
    const result = answer({ id: 's1', requestId: 'r1', optionId: 'yes' })
    expect(result).toEqual({ ok: true, value: {} })
    expect(answerPermission.output.safeParse(result).success).toBe(true)
    expect(answered).toEqual([['r1', 'yes']])
    expect(transcript.openCardCount('s1')).toBe(0)
    expect(store.entriesOf('s1')[0]?.entry).toEqual({
      kind: 'answers',
      card: 'decision',
      toolId: 't1',
      outcome: 'submitted',
      rows: [{ question: 'Run this command?', answer: 'Yes' }]
    })
    expect(events.map((event) => event.change.type)).toEqual(['card-closed'])
  })

  it('refuses an unknown session, an unknown request and an option that the request did not offer, and sends nothing to the agent', () => {
    const { transcript, answered, answer } = setup()
    expect(answer({ id: 'nope', requestId: 'r1', optionId: 'yes' })).toMatchObject({ ok: false, error: { code: 'unknown-session' } })
    expect(answer({ id: 's1', requestId: 'nope', optionId: 'yes' })).toMatchObject({ ok: false, error: { code: 'unknown-request', message: 'This permission request is closed.' } })
    expect(answer({ id: 's1', requestId: 'r1', optionId: 'other' })).toMatchObject({ ok: false, error: { code: 'unknown-option', message: 'Aether cannot send this answer.' } })
    expect(answered).toEqual([])
    expect(transcript.openCardCount('s1')).toBe(1)
  })

  it('refuses an answer for a form, and a second answer for the same request', () => {
    const { transcript, answer } = setup()
    transcript.openElicitation('s1', { id: 'f1', toolId: null, message: 'm', fields: [], recommended: null, keepsText: true })
    expect(answer({ id: 's1', requestId: 'f1', optionId: 'yes' })).toMatchObject({ ok: false, error: { code: 'unknown-request' } })
    expect(answer({ id: 's1', requestId: 'r1', optionId: 'yes' }).ok).toBe(true)
    expect(answer({ id: 's1', requestId: 'r1', optionId: 'no' })).toMatchObject({ ok: false, error: { code: 'unknown-request' } })
  })

  it('refuses when the session has no process, so a card never closes without its agent', () => {
    const { transcript, answer, processes } = setup()
    processes.drop('s1', processes.get('s1') as AgentProcess)
    expect(answer({ id: 's1', requestId: 'r1', optionId: 'yes' })).toMatchObject({ ok: false, error: { code: 'unknown-request' } })
    expect(transcript.openCardCount('s1')).toBe(1)
  })
})
