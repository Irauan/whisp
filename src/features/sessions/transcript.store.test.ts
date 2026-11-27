import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../building-blocks/database'
import { MIGRATIONS } from '../../building-blocks/migrations'
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
  const make = () =>
    new Transcript(store, (event) => events.push(event), { now: () => new Date('2026-01-02T00:00:00.000Z') }, { next: () => `e${++count}` })
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
      revision: 2
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

  it('adds each plan as a new entry with the three step states', () => {
    const { store, transcript } = setup()
    transcript.addPlan('s1', { type: 'plan', steps: [{ text: 'One', status: 'pending' }, { text: 'Two', status: 'pending' }] })
    transcript.addPlan('s1', { type: 'plan', steps: [{ text: 'One', status: 'completed' }, { text: 'Two', status: 'in_progress' }] })
    expect(store.entriesOf('s1').map((view) => view.entry)).toEqual([
      { kind: 'plan', steps: [{ text: 'One', status: 'pending' }, { text: 'Two', status: 'pending' }] },
      { kind: 'plan', steps: [{ text: 'One', status: 'completed' }, { text: 'Two', status: 'in_progress' }] }
    ])
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
})
