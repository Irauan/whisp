import type { z } from 'zod'
import type { openSession, sessionEventSchema } from '../../features/sessions/open/open.contract'

/** The snapshot of `sessions.open`: the view of one session window. */
export type SessionSnapshot = z.output<typeof openSession.result>

export type SessionEvent = z.output<typeof sessionEventSchema>
type Change = SessionEvent['change']

/** The view state of a session window. The main process owns the data (decision 0002). */
export interface SessionWindowState {
  /** The last snapshot with the events applied to it. Null before the first snapshot. */
  view: SessionSnapshot | null
  /** Events that came before the first snapshot. They apply after it. */
  pending: SessionEvent[]
  /** True when an event did not fit: the window must load a new snapshot. */
  needsSnapshot: boolean
}

export type SessionWindowAction = { type: 'snapshot'; snapshot: SessionSnapshot } | { type: 'event'; event: SessionEvent }

export const emptyWindowState: SessionWindowState = { view: null, pending: [], needsSnapshot: false }

/** Applies one change to a view. It returns null when the change does not fit the view: a gap in the data. */
export function applyChange(view: SessionSnapshot, change: Change): SessionSnapshot | null {
  switch (change.type) {
    case 'entry-added':
      return { ...view, draft: false, entries: [...view.entries, change.entry] }
    case 'entry-text': {
      const index = view.entries.findIndex((item) => item.id === change.id)
      const entry = view.entries[index]?.entry
      if (entry?.kind !== 'agent' && entry?.kind !== 'thought') return null
      const joined = { ...entry, text: entry.text + change.text }
      return { ...view, entries: view.entries.map((item, at) => (at === index ? { ...item, entry: joined } : item)) }
    }
    case 'entry-replaced': {
      if (!view.entries.some((item) => item.id === change.entry.id)) return null
      return { ...view, entries: view.entries.map((item) => (item.id === change.entry.id ? change.entry : item)) }
    }
    case 'status':
      return { ...view, status: change.status, draft: view.draft && change.status === 'idle' }
  }
}

/**
 * Applies an event, in the order of its revision. An old event changes nothing. The next revision
 * applies. A later revision is a gap: the state asks for a new snapshot (architecture, State).
 */
function applyEvent(state: SessionWindowState, view: SessionSnapshot, event: SessionEvent): SessionWindowState {
  if (event.revision <= view.revision) return { ...state, view }
  if (event.revision !== view.revision + 1) return { view, pending: [], needsSnapshot: true }
  const next = applyChange(view, event.change)
  if (next === null) return { view, pending: [], needsSnapshot: true }
  return { ...state, view: { ...next, revision: event.revision } }
}

export function reduceSessionWindow(state: SessionWindowState, action: SessionWindowAction): SessionWindowState {
  if (action.type === 'event') {
    if (state.view === null) return { ...state, pending: [...state.pending, action.event] }
    return applyEvent(state, state.view, action.event)
  }
  // A snapshot that is older than the view is stale: a newer load already answered.
  if (state.view !== null && action.snapshot.revision < state.view.revision) return { ...state, needsSnapshot: false }
  let next: SessionWindowState = { view: action.snapshot, pending: [], needsSnapshot: false }
  for (const event of state.pending.toSorted((a, b) => a.revision - b.revision)) {
    if (next.view === null || next.needsSnapshot) break
    next = applyEvent(next, next.view, event)
  }
  return next
}
