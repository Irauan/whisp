import { describe, expect, it } from 'vitest'
import type { AgentUpdate } from '../../../building-blocks/agent.port'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import type { SessionEvent } from '../entry'
import { SessionStore } from '../session.store'
import { Transcript } from '../transcript.store'
import { recordAgentUpdateHandler } from './record-agent-update.handler'

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
    for (const update of updates) recordAgentUpdateHandler({ transcript }, { sessionId: 's1', update })
  }
  return { store, events, transcript, record }
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

  it('records each plan, with the three states of the steps (A11)', () => {
    const { store, record } = setup()
    record(
      { type: 'plan', steps: [{ text: 'One', status: 'pending' }, { text: 'Two', status: 'pending' }, { text: 'Three', status: 'pending' }] },
      { type: 'plan', steps: [{ text: 'One', status: 'completed' }, { text: 'Two', status: 'in_progress' }, { text: 'Three', status: 'pending' }] }
    )
    const plans = store.entriesOf('s1').map((view) => view.entry)
    expect(plans).toHaveLength(2)
    expect(plans.at(-1)).toEqual({
      kind: 'plan',
      steps: [
        { text: 'One', status: 'completed' },
        { text: 'Two', status: 'in_progress' },
        { text: 'Three', status: 'pending' }
      ]
    })
  })

  it('does nothing for a session that is gone', () => {
    const { store, events, transcript, record } = setup()
    transcript.forget('s1')
    record({ type: 'text', text: 'late' }, { type: 'plan', steps: [] })
    expect(events).toEqual([])
    expect(store.entriesOf('s1')).toEqual([])
  })
})
