import { describe, expect, it } from 'vitest'
import type { AgentUpdate, Elicitation, PermissionRequest } from '../../../building-blocks/agent.port'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import type { SessionEvent } from '../entry'
import { SessionStore } from '../session.store'
import { Transcript } from '../transcript.store'
import type { AgentRequestEvent } from '../cards'
import { recordAgentRequestHandler, recordAgentUpdateHandler } from './record-agent-update.handler'

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
  const record = (...updates: AgentUpdate[]) => {
    for (const update of updates) recordAgentUpdateHandler({ transcript, store }, { sessionId: 's1', update })
  }
  const recordRequest = (event: AgentRequestEvent) => recordAgentRequestHandler({ transcript, store }, { sessionId: 's1', event })
  return { store, database, events, transcript, record, recordRequest }
}

describe('record-agent-update', () => {
  it('joins the streamed text of the agent into one entry, and saves it when another entry follows', () => {
    const { store, events, transcript, record } = setup()
    record({ type: 'text', text: 'Hello ' }, { type: 'text', text: 'from the agent.' })
    expect(store.entriesOf('s1')).toEqual([])
    expect(events.map((event) => event.change.type)).toEqual(['entry-added', 'entry-text'])
    transcript.flush('s1')
    expect(store.entriesOf('s1')).toEqual([{ id: 'e1', entry: { kind: 'agent', text: 'Hello from the agent.' } }])
  })

  it('records a thought apart from the reply', () => {
    const { store, transcript, record } = setup()
    record({ type: 'thought', text: 'hm' }, { type: 'text', text: 'ok' })
    transcript.flush('s1')
    expect(store.entriesOf('s1').map((view) => view.entry)).toEqual([
      { kind: 'thought', text: 'hm' },
      { kind: 'agent', text: 'ok' }
    ])
  })

  it('records a tool call and its later states in one entry', () => {
    const { store, record } = setup()
    record(
      { type: 'tool', id: 't1', title: 'Run the test suite', toolKind: 'execute', status: 'in_progress' },
      { type: 'tool-update', id: 't1', title: null, toolKind: null, status: 'completed' }
    )
    expect(store.entriesOf('s1').map((view) => view.entry)).toEqual([
      { kind: 'tool', toolId: 't1', title: 'Run the test suite', toolKind: 'execute', status: 'completed' }
    ])
  })

  it('records a plan, and replaces it in place when only the states change (A11)', () => {
    const { store, events, record } = setup()
    record(
      { type: 'plan', steps: [{ text: 'One', status: 'pending' }, { text: 'Two', status: 'pending' }, { text: 'Three', status: 'pending' }] },
      { type: 'plan', steps: [{ text: 'One', status: 'completed' }, { text: 'Two', status: 'in_progress' }, { text: 'Three', status: 'pending' }] }
    )
    const plans = store.entriesOf('s1').map((view) => view.entry)
    expect(plans).toHaveLength(1)
    expect(plans.at(-1)).toEqual({
      kind: 'plan',
      steps: [
        { text: 'One', status: 'completed' },
        { text: 'Two', status: 'in_progress' },
        { text: 'Three', status: 'pending' }
      ]
    })
    expect(events.map((event) => event.change.type)).toEqual(['entry-added', 'entry-replaced'])
  })

  it('records another plan as a new entry', () => {
    const { store, record } = setup()
    record(
      { type: 'plan', steps: [{ text: 'One', status: 'pending' }] },
      { type: 'plan', steps: [{ text: 'Other', status: 'pending' }, { text: 'Two', status: 'pending' }] }
    )
    expect(store.entriesOf('s1')).toHaveLength(2)
  })

  it('adds a notice when the row says Auto and the agent reports Accept edits (A12)', () => {
    const { store, database, record } = setup()
    database.prepare("UPDATE sessions SET mode = 'auto' WHERE id = 's1'").run()
    record({ type: 'mode', mode: 'accept-edits' })
    const notices = store.entriesOf('s1').map((view) => view.entry)
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ kind: 'notice', tone: 'info', code: 'auto-fallback' })
    expect(notices[0]).toMatchObject({ text: expect.stringMatching(/\bAuto\b[\s\S]*\bAccept edits\b/) })
  })

  it('adds no notice for any other mode report, or when the row says another mode', () => {
    const { store, database, record } = setup()
    record({ type: 'mode', mode: 'accept-edits' })
    record({ type: 'mode', mode: 'plan' })
    database.prepare("UPDATE sessions SET mode = 'auto' WHERE id = 's1'").run()
    record({ type: 'mode', mode: 'auto' }, { type: 'mode', mode: 'plan' })
    expect(store.entriesOf('s1')).toEqual([])
  })

  it('does nothing for a mode report of a session that is gone', () => {
    const { store, database, record } = setup()
    database.prepare("UPDATE sessions SET mode = 'auto' WHERE id = 's1'").run()
    database.prepare("DELETE FROM sessions WHERE id = 's1'").run()
    record({ type: 'mode', mode: 'accept-edits' })
    expect(store.entriesOf('s1')).toEqual([])
  })

  it('does nothing for a session that is gone', () => {
    const { store, events, transcript, record } = setup()
    transcript.forget('s1')
    record({ type: 'text', text: 'late' }, { type: 'plan', steps: [] })
    expect(events).toEqual([])
    expect(store.entriesOf('s1')).toEqual([])
  })
})

describe('record-agent-update: the live mode and the model', () => {
  const modes = (events: SessionEvent[]) => events.flatMap((event) => (event.change.type === 'mode' ? [event.change.mode] : []))

  it('saves the mode that the agent reports, and shows it as the live mode, so a new process starts in it', () => {
    const { store, events, transcript, record } = setup()
    record({ type: 'mode', mode: 'accept-edits' })
    expect(store.find('s1')?.mode).toBe('accept-edits')
    expect(transcript.liveModeOf('s1')).toBe('accept-edits')
    expect(modes(events)).toEqual(['accept-edits'])
  })

  it('shows Approve all, but never saves it: the saved mode stays the last saved mode', () => {
    const { store, events, transcript, record } = setup()
    record({ type: 'mode', mode: 'accept-edits' }, { type: 'mode', mode: 'approve-all' })
    expect(store.find('s1')?.mode).toBe('accept-edits')
    expect(transcript.liveModeOf('s1')).toBe('approve-all')
    expect(modes(events)).toEqual(['accept-edits', 'approve-all'])
  })

  it('keeps Auto saved when the report comes with the notice of the fallback, and still shows the live mode', () => {
    const { store, database, events, transcript, record } = setup()
    database.prepare("UPDATE sessions SET mode = 'auto' WHERE id = 's1'").run()
    record({ type: 'mode', mode: 'accept-edits' })
    expect(store.find('s1')?.mode).toBe('auto')
    expect(transcript.liveModeOf('s1')).toBe('accept-edits')
    expect(modes(events)).toEqual(['accept-edits'])
    expect(store.entriesOf('s1').map((view) => view.entry)).toMatchObject([{ kind: 'notice', code: 'auto-fallback' }])
  })

  it('sends no change for a report of the mode that the window already shows', () => {
    const { events, record } = setup()
    record({ type: 'mode', mode: 'ask' }, { type: 'mode', mode: 'plan' }, { type: 'mode', mode: 'plan' })
    expect(modes(events)).toEqual(['plan'])
  })

  it('saves the model of the refusal fallback and tells the window', () => {
    const { store, events, record } = setup()
    record({ type: 'model', model: 'claude-opus-5-5' })
    expect(store.find('s1')?.model).toBe('claude-opus-5-5')
    expect(events.map((event) => event.change)).toEqual([{ type: 'model', model: 'claude-opus-5-5' }])
  })
})

describe('record-agent-update: the requests of the agent', () => {
  const permission: PermissionRequest = {
    id: 'r1',
    toolId: 't1',
    title: 'npm test',
    toolKind: 'execute',
    locations: [],
    options: [{ id: 'yes', label: 'Yes', kind: 'allow-once' }]
  }
  const form: Elicitation = { id: 'f1', toolId: 'a1', message: 'Which runner?', fields: [], recommended: null, keepsText: true }

  it('opens a card for a request and for a form', () => {
    const { store, transcript, recordRequest } = setup()
    recordRequest({ type: 'permission', request: permission })
    recordRequest({ type: 'elicitation', form })
    expect(transcript.openCardCount('s1')).toBe(2)
    expect(store.entriesOf('s1').map((view) => view.entry)).toMatchObject([
      { kind: 'answers', card: 'decision', outcome: 'open' },
      { kind: 'answers', card: 'question', outcome: 'open' }
    ])
  })

  it('closes a card with the reason that the provider gives, and a second close changes nothing', () => {
    const { store, transcript, recordRequest } = setup()
    recordRequest({ type: 'permission', request: permission })
    recordRequest({ type: 'elicitation', form })
    recordRequest({ type: 'permission-closed', id: 'r1', reason: 'withdrawn' })
    recordRequest({ type: 'permission-closed', id: 'r1', reason: 'exited' })
    recordRequest({ type: 'elicitation-closed', id: 'f1', reason: 'exited' })
    expect(transcript.openCardCount('s1')).toBe(0)
    expect(store.entriesOf('s1').map((view) => (view.entry.kind === 'answers' ? view.entry.outcome : null))).toEqual(['withdrawn', 'exited'])
  })
})
