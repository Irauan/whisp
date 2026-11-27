import { describe, expect, it } from 'vitest'
import { LOG_MARKER } from '../../shared/log-marker'
import {
  applyChange,
  emptyWindowState,
  isAtBottom,
  latestPlan,
  markedPlanIds,
  planCount,
  reduceSessionWindow,
  shownModel,
  splitFailedTurn,
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

const step = (text: string, status: 'pending' | 'in_progress' | 'completed') => ({ text, status })
const plan = (id: string, ...steps: ReturnType<typeof step>[]) => ({ id, entry: { kind: 'plan' as const, steps } })

describe('latestPlan and planCount', () => {
  it('finds the latest plan entry, and no plan when the session has none or the latest has no steps', () => {
    expect(latestPlan([user])).toBeNull()
    expect(latestPlan([plan('a', step('One', 'pending')), user, plan('b', step('Two', 'pending'))])).toEqual([step('Two', 'pending')])
    // A plan with no steps clears the plan: the widget does not show.
    expect(latestPlan([plan('a', step('One', 'pending')), plan('b')])).toBeNull()
  })

  it('counts the completed steps and all steps for the header "Plan N of M"', () => {
    expect(planCount([step('One', 'completed'), step('Two', 'in_progress'), step('Three', 'pending')])).toEqual({ done: 1, total: 3 })
    expect(planCount([step('One', 'pending')])).toEqual({ done: 0, total: 1 })
    expect(planCount([step('One', 'completed'), step('Two', 'completed')])).toEqual({ done: 2, total: 2 })
  })
})

describe('markedPlanIds', () => {
  const text = { id: 't', entry: { kind: 'agent', text: 'hi' } } as const

  it('marks each plan entry except the first plan entry of the session', () => {
    const entries = [plan('a', step('One', 'pending')), text, plan('b', step('Two', 'pending')), plan('c')]
    expect([...markedPlanIds(entries)]).toEqual(['b', 'c'])
  })

  it('marks nothing for one plan entry, or for a session with no plan', () => {
    expect(markedPlanIds([text, plan('a', step('One', 'pending'))]).size).toBe(0)
    expect(markedPlanIds([text]).size).toBe(0)
  })

  it('marks an empty plan that follows the first plan, and does not mark an empty first plan', () => {
    expect([...markedPlanIds([plan('a'), plan('b', step('One', 'pending'))])]).toEqual(['b'])
    expect([...markedPlanIds([plan('a', step('One', 'pending')), plan('b')])]).toEqual(['b'])
  })
})

describe('isAtBottom', () => {
  it('is true at the end of the content, within two pixels, and false above it', () => {
    expect(isAtBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 })).toBe(true)
    expect(isAtBottom({ scrollTop: 598.5, scrollHeight: 1000, clientHeight: 400 })).toBe(true)
    expect(isAtBottom({ scrollTop: 590, scrollHeight: 1000, clientHeight: 400 })).toBe(false)
    expect(isAtBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 400 })).toBe(true)
  })
})

describe('splitFailedTurn', () => {
  it('splits a failed turn at the marker line: the line, then the last log lines', () => {
    expect(splitFailedTurn({ text: `Claude Code stopped (exit code 7).\n${LOG_MARKER}\nline one\nline two` })).toEqual({
      line: 'Claude Code stopped (exit code 7).',
      log: 'line one\nline two'
    })
  })

  it('splits a failed start with log lines too, also when its message has many lines', () => {
    expect(splitFailedTurn({ text: `Claude Code did not start. A\nB\n${LOG_MARKER}\nsimulated agent: no config` })).toEqual({
      line: 'Claude Code did not start. A\nB',
      log: 'simulated agent: no config'
    })
  })

  it('gives no log when the agent wrote none', () => {
    expect(splitFailedTurn({ text: 'Claude Code stopped (exit code 1).' })).toEqual({ line: 'Claude Code stopped (exit code 1).', log: null })
  })

  it('keeps the text without the marker whole: the sign-in steps stay visible', () => {
    const text = 'Claude Code is not signed in.\n1. Open a terminal.\n2. Run claude.'
    expect(splitFailedTurn({ text })).toEqual({ line: text, log: null })
  })
})

describe('shownModel', () => {
  it('shows the chosen model of a draft, also after Send makes the session no draft', () => {
    // The user picks Opus in a draft. The snapshot of the window still holds the model Default.
    expect(shownModel('claude-opus-5-5', 'default')).toBe('claude-opus-5-5')
    // Send starts the session. The window keeps its old snapshot, and the button keeps the chosen model.
    const afterSend = applyChange(snapshot({ draft: true }), { type: 'entry-added', entry: user })
    expect(afterSend?.draft).toBe(false)
    expect(shownModel('claude-opus-5-5', afterSend?.session.model ?? '')).toBe('claude-opus-5-5')
    // With no choice in this window, the button shows the saved model.
    expect(shownModel(null, 'claude-opus-5-5')).toBe('claude-opus-5-5')
  })
})
