import { describe, expect, it } from 'vitest'
import type { Elicitation, PermissionRequest } from '../../building-blocks/agent.port'
import { openDatabase } from '../../building-blocks/database'
import { MIGRATIONS } from '../../building-blocks/migrations'
import { answeredDecision, closedWithout } from './cards'
import type { SessionEvent } from './entry'
import { SessionStore } from './session.store'
import { Transcript } from './transcript.store'

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
  const make = (cardsClosed?: (sessionId: string) => void) =>
    new Transcript(store, (event) => events.push(event), { now: () => new Date('2026-01-02T00:00:00.000Z') }, { next: () => `e${++count}` }, cardsClosed)
  return { database, store, events, transcript: make(), make }
}

describe('Transcript', () => {
  it('saves an entry and tells the renderer, with revisions that count from 1', () => {
    const { store, events, transcript } = setup()
    transcript.addEntry('s1', { kind: 'user', text: 'Say hello' })
    transcript.setStatus('s1', 'working')
    expect(store.entriesOf('s1')).toEqual([{ id: 'e1', entry: { kind: 'user', text: 'Say hello' } }])
    expect(events).toEqual([
      { sessionId: 's1', revision: 1, change: { type: 'entry-added', entry: { id: 'e1', entry: { kind: 'user', text: 'Say hello' } } } },
      { sessionId: 's1', revision: 2, change: { type: 'status', status: 'working' } }
    ])
  })

  it('counts the revisions of each session apart, and sends no event for a status that did not change', () => {
    const { events, transcript } = setup()
    transcript.setStatus('s1', 'idle')
    transcript.setStatus('s1', 'starting')
    transcript.setStatus('s1', 'starting')
    transcript.setStatus('other', 'starting')
    expect(events.map((event) => [event.sessionId, event.revision])).toEqual([
      ['s1', 1],
      ['other', 1]
    ])
  })

  it('joins streamed text into one entry, and saves it as one row when the entry closes', () => {
    const { database, store, events, transcript } = setup()
    transcript.addText('s1', 'agent', 'Hello ')
    transcript.addText('s1', 'agent', 'from the agent.')
    // The open text is not saved yet, but a snapshot shows it.
    expect(store.entriesOf('s1')).toEqual([])
    expect(transcript.snapshot('s1')).toEqual({
      entries: [{ id: 'e1', entry: { kind: 'agent', text: 'Hello from the agent.' } }],
      status: 'idle',
      revision: 2,
      permissions: [],
      elicitations: [],
      liveMode: null
    })
    transcript.flush('s1')
    expect(database.prepare('SELECT count(*) AS total FROM entries').get()).toMatchObject({ total: 1 })
    expect(store.entriesOf('s1')).toEqual([{ id: 'e1', entry: { kind: 'agent', text: 'Hello from the agent.' } }])
    expect(events.map((event) => event.change)).toEqual([
      { type: 'entry-added', entry: { id: 'e1', entry: { kind: 'agent', text: 'Hello ' } } },
      { type: 'entry-text', id: 'e1', text: 'from the agent.' }
    ])
  })

  it('closes the open text before another entry, so the order stays', () => {
    const { store, transcript } = setup()
    transcript.addText('s1', 'agent', 'Reading')
    transcript.announceTool('s1', { type: 'tool', id: 't1', title: 'Read it', toolKind: 'read', status: 'pending' })
    transcript.addText('s1', 'agent', 'Done')
    transcript.addText('s1', 'thought', 'hm')
    transcript.addEntry('s1', { kind: 'user', text: 'again' })
    expect(store.entriesOf('s1').map((view) => view.entry.kind)).toEqual(['agent', 'tool', 'agent', 'thought', 'user'])
  })

  it('starts a new text entry for another kind of text', () => {
    const { events, transcript } = setup()
    transcript.addText('s1', 'thought', 'hm')
    transcript.addText('s1', 'agent', 'ok')
    expect(events.map((event) => event.change.type)).toEqual(['entry-added', 'entry-added'])
  })

  it('ignores empty text', () => {
    const { events, transcript } = setup()
    transcript.addText('s1', 'agent', '')
    expect(events).toEqual([])
  })

  it('announces a tool call, updates it, and replaces it when the agent announces it again', () => {
    const { store, events, transcript } = setup()
    transcript.announceTool('s1', { type: 'tool', id: 't1', title: 'Run it', toolKind: 'execute', status: 'in_progress' })
    transcript.updateTool('s1', { type: 'tool-update', id: 't1', title: null, toolKind: null, status: 'completed' })
    expect(store.entriesOf('s1')).toHaveLength(1)
    expect(store.entriesOf('s1')[0]?.entry).toMatchObject({ kind: 'tool', title: 'Run it', status: 'completed' })
    transcript.announceTool('s1', { type: 'tool', id: 't1', title: 'Run the tests', toolKind: 'execute', status: 'in_progress' })
    expect(store.entriesOf('s1')).toHaveLength(1)
    expect(store.entriesOf('s1')[0]?.entry).toMatchObject({ title: 'Run the tests', status: 'in_progress' })
    expect(events.map((event) => event.change.type)).toEqual(['entry-added', 'entry-replaced', 'entry-replaced'])
  })

  it('adds a new tool entry when the next turn reuses a call ID, and leaves the earlier turn as it was', () => {
    const { store, transcript } = setup()
    transcript.addEntry('s1', { kind: 'user', text: 'first' })
    transcript.announceTool('s1', { type: 'tool', id: 't1', title: 'Edit README.md', toolKind: 'edit', status: 'in_progress' })
    transcript.updateTool('s1', { type: 'tool-update', id: 't1', title: null, toolKind: null, status: 'completed' })
    transcript.addEntry('s1', { kind: 'user', text: 'second' })
    transcript.announceTool('s1', { type: 'tool', id: 't1', title: 'Edit README.md', toolKind: 'edit', status: 'in_progress' })
    transcript.updateTool('s1', { type: 'tool-update', id: 't1', title: null, toolKind: null, status: 'failed' })
    expect(store.entriesOf('s1').map((view) => view.entry)).toMatchObject([
      { kind: 'user' },
      { kind: 'tool', status: 'completed' },
      { kind: 'user' },
      { kind: 'tool', status: 'failed' }
    ])
  })

  it('ignores the update of a tool call that it does not know', () => {
    const { store, events, transcript } = setup()
    transcript.updateTool('s1', { type: 'tool-update', id: 'unknown', title: null, toolKind: null, status: 'failed' })
    expect(store.entriesOf('s1')).toEqual([])
    expect(events).toEqual([])
  })

  it('fails the tool calls that did not finish, and leaves the others', () => {
    const { store, transcript } = setup()
    transcript.announceTool('s1', { type: 'tool', id: 'a', title: 'A', toolKind: 'read', status: 'completed' })
    transcript.announceTool('s1', { type: 'tool', id: 'b', title: 'B', toolKind: 'read', status: 'in_progress' })
    transcript.announceTool('s1', { type: 'tool', id: 'c', title: 'C', toolKind: 'read', status: 'pending' })
    transcript.failOpenTools('s1')
    expect(store.entriesOf('s1').map((view) => view.entry)).toMatchObject([{ status: 'completed' }, { status: 'failed' }, { status: 'failed' }])
  })

  const plan = (...items: [string, 'pending' | 'in_progress' | 'completed'][]) => ({
    type: 'plan' as const,
    steps: items.map(([text, status]) => ({ text, status }))
  })

  it('adds the first plan as a new entry with the three step states', () => {
    const { store, events, transcript } = setup()
    transcript.addPlan('s1', plan(['One', 'pending'], ['Two', 'pending']))
    expect(store.entriesOf('s1')).toEqual([{ id: 'e1', entry: { kind: 'plan', steps: [{ text: 'One', status: 'pending' }, { text: 'Two', status: 'pending' }] } }])
    expect(events.map((event) => event.change.type)).toEqual(['entry-added'])
  })

  it('replaces the latest plan entry in place when only the states change (progress)', () => {
    const { store, events, transcript } = setup()
    transcript.addPlan('s1', plan(['One', 'pending'], ['Two', 'pending']))
    transcript.addEntry('s1', { kind: 'user', text: 'later' })
    transcript.addPlan('s1', plan(['One', 'completed'], ['Two', 'in_progress']))
    // The entry keeps its ID and its position, so the marker of the transcript stays at the place of the plan.
    expect(store.entriesOf('s1')).toEqual([
      { id: 'e1', entry: { kind: 'plan', steps: [{ text: 'One', status: 'completed' }, { text: 'Two', status: 'in_progress' }] } },
      { id: 'e2', entry: { kind: 'user', text: 'later' } }
    ])
    expect(events.map((event) => event.change.type)).toEqual(['entry-added', 'entry-added', 'entry-replaced'])
    expect(events.at(-1)?.change).toMatchObject({ type: 'entry-replaced', entry: { id: 'e1' } })
  })

  it('adds a new plan entry when the texts, their order or their number change', () => {
    const { store, transcript } = setup()
    transcript.addPlan('s1', plan(['One', 'pending'], ['Two', 'pending']))
    transcript.addPlan('s1', plan(['Two', 'pending'], ['One', 'pending']))
    transcript.addPlan('s1', plan(['Two', 'pending']))
    transcript.addPlan('s1', plan())
    expect(store.entriesOf('s1').map((view) => (view.entry.kind === 'plan' ? view.entry.steps.length : -1))).toEqual([2, 2, 1, 0])
  })

  it('compares with the latest plan entry of the session, also from an earlier turn, and treats two empty plans as progress', () => {
    const { store, make, transcript } = setup()
    transcript.addPlan('s1', plan(['One', 'pending']))
    transcript.addEntry('s1', { kind: 'user', text: 'next turn' })
    transcript.addPlan('s1', plan())
    // A new Transcript, as after a restart, reads the latest plan entry from the database.
    const restarted = make()
    restarted.addPlan('s1', plan())
    expect(store.entriesOf('s1').map((view) => view.entry.kind)).toEqual(['plan', 'user', 'plan'])
    restarted.addPlan('s1', plan(['One', 'pending']))
    expect(store.entriesOf('s1')).toHaveLength(4)
  })

  it('closes the open text of the agent before it writes a plan, so text before and after a plan stays apart', () => {
    const { store, transcript } = setup()
    transcript.addText('s1', 'agent', 'Before ')
    transcript.addPlan('s1', plan(['One', 'pending']))
    transcript.addText('s1', 'agent', 'after.')
    transcript.addPlan('s1', plan(['One', 'completed']))
    transcript.addText('s1', 'agent', 'More.')
    transcript.flush('s1')
    expect(store.entriesOf('s1').map((view) => view.entry)).toEqual([
      { kind: 'agent', text: 'Before ' },
      { kind: 'plan', steps: [{ text: 'One', status: 'completed' }] },
      { kind: 'agent', text: 'after.' },
      { kind: 'agent', text: 'More.' }
    ])
  })

  it('writes nothing for a plan of a session that is gone', () => {
    const { store, events, transcript } = setup()
    transcript.forget('s1')
    transcript.addPlan('s1', plan(['One', 'pending']))
    expect(events).toEqual([])
    expect(store.entriesOf('s1')).toEqual([])
  })

  it('continues the positions after the saved entries, also in a new Transcript after a restart', () => {
    const { store, make, transcript } = setup()
    transcript.addEntry('s1', { kind: 'user', text: 'one' })
    const restarted = make()
    restarted.addEntry('s1', { kind: 'user', text: 'two' })
    expect(store.entriesOf('s1').map((view) => view.entry)).toEqual([
      { kind: 'user', text: 'one' },
      { kind: 'user', text: 'two' }
    ])
    // The status and the revision start again after a restart. The renderer loads a snapshot.
    expect(restarted.snapshot('s1').revision).toBe(1)
  })

  it('saves nothing and sends nothing for a session that is gone', () => {
    const { database, events, transcript } = setup()
    transcript.addText('s1', 'agent', 'Hello')
    transcript.forget('s1')
    database.prepare("DELETE FROM sessions WHERE id = 's1'").run()
    const before = events.length
    transcript.addText('s1', 'agent', 'more')
    transcript.addEntry('s1', { kind: 'user', text: 'x' })
    transcript.announceTool('s1', { type: 'tool', id: 'a', title: 'A', toolKind: 'read', status: 'pending' })
    transcript.setStatus('s1', 'working')
    transcript.flush('s1')
    expect(events).toHaveLength(before)
    expect(database.prepare('SELECT count(*) AS total FROM entries').get()).toMatchObject({ total: 0 })
  })

  describe('cards', () => {
    const request: PermissionRequest = {
      id: 'r1',
      toolId: 't1',
      title: null,
      toolKind: null,
      locations: [],
      options: [
        { id: 'yes', label: 'Yes', kind: 'allow-once' },
        { id: 'no', label: 'No', kind: 'refuse-once' }
      ]
    }
    const second: PermissionRequest = { ...request, id: 'r2', toolId: 't2' }
    const form: Elicitation = {
      id: 'f1',
      toolId: 'a1',
      message: 'Which runner?',
      fields: [{ key: 'question_0', kind: 'choice', title: null, description: null, options: [{ value: 'Jest', label: 'Jest', description: null }] }],
      recommended: null,
      keepsText: true
    }

    it('saves the entry of a card with the outcome open, and sends one change that carries the entry and its request', () => {
      const { store, events, transcript } = setup()
      transcript.announceTool('s1', { type: 'tool', id: 't1', title: 'npm test', toolKind: 'execute', status: 'pending' })
      events.length = 0
      transcript.openPermission('s1', request)
      const saved = store.entriesOf('s1')
      expect(saved.map((view) => view.entry.kind)).toEqual(['tool', 'answers'])
      expect(saved[1]?.entry).toEqual({ kind: 'answers', card: 'decision', toolId: 't1', outcome: 'open', rows: [{ question: 'Run this command?', answer: null }] })
      expect(events).toHaveLength(1)
      expect(events[0]?.change).toMatchObject({
        type: 'card-opened',
        entry: { id: saved[1]?.id },
        card: { kind: 'permission', permission: { id: 'r1', entryId: saved[1]?.id, title: 'npm test', toolKind: 'execute' } }
      })
      expect(transcript.openCardCount('s1')).toBe(1)
      expect(transcript.snapshot('s1').permissions.map((item) => item.id)).toEqual(['r1'])
    })

    it('shows the cards in the order of arrival, the entries of both kinds in the same sequence', () => {
      const { transcript } = setup()
      transcript.openPermission('s1', request)
      transcript.openElicitation('s1', form)
      transcript.openPermission('s1', second)
      const snapshot = transcript.snapshot('s1')
      expect(snapshot.permissions.map((item) => item.id)).toEqual(['r1', 'r2'])
      expect(snapshot.elicitations.map((item) => item.id)).toEqual(['f1'])
      expect(snapshot.entries.map((view) => view.entry.kind)).toEqual(['answers', 'answers', 'answers'])
      expect(snapshot.revision).toBe(3)
    })

    it('replaces the entry in place when a card closes, and the first close wins', () => {
      const { store, events, transcript } = setup()
      transcript.openPermission('s1', request)
      transcript.openPermission('s1', second)
      const [first] = store.entriesOf('s1')
      expect(transcript.closeCard('s1', 'r1', (card) => answeredDecision(card.entry, 'Yes'))).toBe(true)
      expect(transcript.closeCard('s1', 'r1', (card) => closedWithout(card.entry, 'withdrawn'))).toBe(false)
      expect(store.entriesOf('s1')[0]).toEqual({
        id: first?.id,
        entry: { kind: 'answers', card: 'decision', toolId: 't1', outcome: 'submitted', rows: [{ question: 'Allow this tool?', answer: 'Yes' }] }
      })
      expect(store.entriesOf('s1')).toHaveLength(2)
      const closed = events.filter((event) => event.change.type === 'card-closed')
      expect(closed).toHaveLength(1)
      expect(closed[0]?.change).toMatchObject({ type: 'card-closed', id: 'r1', entry: { id: first?.id } })
      expect(transcript.snapshot('s1').permissions.map((item) => item.id)).toEqual(['r2'])
    })

    it('tells the composition root when the last card of a session closed, and only then', () => {
      const closed: string[] = []
      const { make } = setup()
      const transcript = make((sessionId) => closed.push(sessionId))
      transcript.openPermission('s1', request)
      transcript.openPermission('s1', second)
      transcript.closeCard('s1', 'r1', (card) => closedWithout(card.entry, 'stopped'))
      expect(closed).toEqual([])
      transcript.closeCard('s1', 'r2', (card) => closedWithout(card.entry, 'stopped'))
      transcript.closeCard('s1', 'r2', (card) => closedWithout(card.entry, 'stopped'))
      expect(closed).toEqual(['s1'])
    })

    it('closes every card of a session with one outcome, in the order of arrival', () => {
      const { store, transcript } = setup()
      transcript.openPermission('s1', request)
      transcript.openElicitation('s1', form)
      expect(transcript.closeAllCards('s1', (card) => closedWithout(card.entry, 'stopped'))).toBe(2)
      expect(store.entriesOf('s1').map((view) => (view.entry.kind === 'answers' ? view.entry.outcome : null))).toEqual(['stopped', 'stopped'])
      expect(transcript.openCardCount('s1')).toBe(0)
      expect(transcript.sessionsWithCards()).toEqual([])
    })

    it('forgets the cards of a deleted session without a change or an entry', () => {
      const { database, events, transcript } = setup()
      transcript.openPermission('s1', request)
      transcript.forget('s1')
      database.prepare("DELETE FROM sessions WHERE id = 's1'").run()
      const before = events.length
      expect(transcript.closeCard('s1', 'r1', (card) => closedWithout(card.entry, 'exited'))).toBe(false)
      transcript.openPermission('s1', second)
      expect(events).toHaveLength(before)
      expect(database.prepare('SELECT count(*) AS total FROM entries').get()).toMatchObject({ total: 0 })
    })

    it('keeps the live mode apart from the saved mode, and shows the saved mode again after a clear', () => {
      const { events, transcript } = setup()
      transcript.setLiveMode('s1', 'approve-all')
      expect(transcript.snapshot('s1').liveMode).toBe('approve-all')
      expect(transcript.liveModeOf('s1')).toBe('approve-all')
      transcript.clearLiveMode('s1', 'ask')
      transcript.clearLiveMode('s1', 'ask')
      expect(transcript.snapshot('s1').liveMode).toBeNull()
      expect(events.map((event) => event.change)).toEqual([
        { type: 'mode', mode: 'approve-all' },
        { type: 'mode', mode: 'ask' }
      ])
      transcript.setModel('s1', 'claude-opus-5-5')
      expect(events.at(-1)?.change).toEqual({ type: 'model', model: 'claude-opus-5-5' })
    })

    it('tells the window the new title, and sends nothing for a session that is gone', () => {
      const { events, transcript } = setup()
      transcript.setTitle('s1', 'Greeting test')
      expect(events.map((event) => event.change)).toEqual([{ type: 'title', title: 'Greeting test' }])
      transcript.forget('s1')
      transcript.setTitle('s1', 'Late title')
      expect(events).toHaveLength(1)
    })
  })
})
