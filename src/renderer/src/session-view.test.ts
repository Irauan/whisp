import { describe, expect, it } from 'vitest'
import {
  applyChange,
  emptyWindowState,
  reduceSessionWindow,
  type SessionEvent,
  type SessionSnapshot,
  type SessionWindowAction,
  type SessionWindowState
} from './session-view'

const session: SessionSnapshot['session'] = {
  id: 's1',
  profileId: 'p1',
  title: 'Say hello',
  prompt: 'Say hello',
  mode: 'ask',
  providerId: null,
  sourcePath: 'C:\\work',
  model: 'default',
  attachments: [],
  createdAt: '2026-01-01'
}

const snapshot = (part: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  session,
  entries: [],
  status: 'idle',
  revision: 0,
  draft: true,
  ...part
})

const event = (revision: number, change: SessionEvent['change']): SessionEvent => ({ sessionId: 's1', revision, change })
const user = { id: 'e1', entry: { kind: 'user', text: 'Say hello' } } as const

const run = (actions: SessionWindowAction[], from: SessionWindowState = emptyWindowState) => actions.reduce(reduceSessionWindow, from)

describe('applyChange', () => {
  it('adds an entry at the end, and the session is no draft any more', () => {
    const view = applyChange(snapshot(), { type: 'entry-added', entry: user })
    expect(view).toMatchObject({ draft: false, entries: [user] })
  })

  it('appends streamed text to the text or thought entry that it names', () => {
    const start = snapshot({ entries: [user, { id: 'e2', entry: { kind: 'agent', text: 'Hello ' } }, { id: 'e3', entry: { kind: 'thought', text: 'hm' } }] })
    const view = applyChange(start, { type: 'entry-text', id: 'e2', text: 'there.' })
    expect(view?.entries.map((item) => item.entry)).toEqual([
      { kind: 'user', text: 'Say hello' },
      { kind: 'agent', text: 'Hello there.' },
      { kind: 'thought', text: 'hm' }
    ])
    expect(start.entries[1]?.entry).toEqual({ kind: 'agent', text: 'Hello ' })
  })

  it('does not fit text for an entry that is not there, or is not a text entry', () => {
    expect(applyChange(snapshot(), { type: 'entry-text', id: 'missing', text: 'x' })).toBeNull()
    expect(applyChange(snapshot({ entries: [user] }), { type: 'entry-text', id: 'e1', text: 'x' })).toBeNull()
  })

  it('replaces an entry, and does not fit a replacement of an entry that is not there', () => {
    const tool = { id: 't', entry: { kind: 'tool', toolId: 'a', title: 'Run it', toolKind: 'execute', status: 'in_progress' } } as const
    const failed = { id: 't', entry: { ...tool.entry, status: 'failed' } } as const
    expect(applyChange(snapshot({ entries: [tool] }), { type: 'entry-replaced', entry: failed })?.entries).toEqual([failed])
    expect(applyChange(snapshot(), { type: 'entry-replaced', entry: failed })).toBeNull()
  })

  it('sets the status, and a session that is not Idle is no draft', () => {
    expect(applyChange(snapshot(), { type: 'status', status: 'starting' })).toMatchObject({ status: 'starting', draft: false })
    expect(applyChange(snapshot(), { type: 'status', status: 'idle' })).toMatchObject({ status: 'idle', draft: true })
  })
})

describe('reduceSessionWindow', () => {
  it('shows the snapshot', () => {
    expect(run([{ type: 'snapshot', snapshot: snapshot() }])).toEqual({ view: snapshot(), pending: [], needsSnapshot: false })
  })

  it('applies the next revision, and ignores an old one', () => {
    const state = run([
      { type: 'snapshot', snapshot: snapshot({ revision: 3 }) },
      { type: 'event', event: event(3, { type: 'entry-added', entry: user }) },
      { type: 'event', event: event(4, { type: 'status', status: 'working' }) },
      { type: 'event', event: event(4, { type: 'status', status: 'idle' }) }
    ])
    expect(state.view).toMatchObject({ revision: 4, status: 'working', entries: [] })
    expect(state.needsSnapshot).toBe(false)
  })

  it('asks for a new snapshot at a gap in the revisions, and keeps the view', () => {
    const state = run([
      { type: 'snapshot', snapshot: snapshot({ revision: 1 }) },
      { type: 'event', event: event(3, { type: 'status', status: 'working' }) }
    ])
    expect(state.needsSnapshot).toBe(true)
    expect(state.view).toMatchObject({ revision: 1, status: 'idle' })
  })

  it('asks for a new snapshot when a change does not fit the view', () => {
    const state = run([
      { type: 'snapshot', snapshot: snapshot({ revision: 1 }) },
      { type: 'event', event: event(2, { type: 'entry-text', id: 'missing', text: 'x' }) }
    ])
    expect(state.needsSnapshot).toBe(true)
  })

  it('takes the new snapshot after a gap, and the window then goes on', () => {
    const gap = run([
      { type: 'snapshot', snapshot: snapshot({ revision: 1 }) },
      { type: 'event', event: event(5, { type: 'status', status: 'working' }) }
    ])
    const state = run(
      [
        { type: 'snapshot', snapshot: snapshot({ revision: 5, status: 'working', draft: false }) },
        { type: 'event', event: event(6, { type: 'status', status: 'idle' }) }
      ],
      gap
    )
    expect(state).toMatchObject({ needsSnapshot: false, view: { revision: 6, status: 'idle' } })
  })

  it('keeps the events that come before the first snapshot, and applies the newer ones after it', () => {
    const state = run([
      { type: 'event', event: event(2, { type: 'status', status: 'working' }) },
      { type: 'event', event: event(1, { type: 'entry-added', entry: user }) },
      { type: 'event', event: event(3, { type: 'status', status: 'idle' }) },
      { type: 'snapshot', snapshot: snapshot({ revision: 1, draft: false, entries: [user] }) }
    ])
    expect(state.needsSnapshot).toBe(false)
    expect(state.pending).toEqual([])
    expect(state.view).toMatchObject({ revision: 3, status: 'idle', entries: [user] })
  })

  it('asks for a new snapshot when the events before the snapshot leave a gap after it', () => {
    const state = run([
      { type: 'event', event: event(5, { type: 'status', status: 'working' }) },
      { type: 'snapshot', snapshot: snapshot({ revision: 1 }) }
    ])
    expect(state.needsSnapshot).toBe(true)
  })

  it('ignores a snapshot that is older than the view', () => {
    const state = run([
      { type: 'snapshot', snapshot: snapshot({ revision: 4, status: 'working' }) },
      { type: 'snapshot', snapshot: snapshot({ revision: 2 }) }
    ])
    expect(state.view).toMatchObject({ revision: 4, status: 'working' })
  })

  it('joins streamed text in the order of the events', () => {
    const state = run([
      { type: 'snapshot', snapshot: snapshot({ revision: 0 }) },
      { type: 'event', event: event(1, { type: 'entry-added', entry: { id: 'a', entry: { kind: 'agent', text: 'Hello ' } } }) },
      { type: 'event', event: event(2, { type: 'entry-text', id: 'a', text: 'from the agent.' }) }
    ])
    expect(state.view?.entries).toEqual([{ id: 'a', entry: { kind: 'agent', text: 'Hello from the agent.' } }])
  })
})
