import type { z } from 'zod'
import type { openSession, sessionEventSchema } from '../../features/sessions/open/open.contract'
import { splitLog } from '../../shared/log-marker'

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
    case 'card-opened': {
      // The entry and its request come together, so the view never holds an open entry without its request.
      const { card } = change
      return {
        ...view,
        draft: false,
        entries: [...view.entries, change.entry],
        permissions: card.kind === 'permission' ? [...view.permissions, card.permission] : view.permissions,
        elicitations: card.kind === 'elicitation' ? [...view.elicitations, card.elicitation] : view.elicitations
      }
    }
    case 'card-closed': {
      if (!view.entries.some((item) => item.id === change.entry.id)) return null
      return {
        ...view,
        entries: view.entries.map((item) => (item.id === change.entry.id ? change.entry : item)),
        permissions: view.permissions.filter((item) => item.id !== change.id),
        elicitations: view.elicitations.filter((item) => item.id !== change.id)
      }
    }
    case 'mode':
      return { ...view, liveMode: change.mode }
    case 'model':
      // No other event changes the session row: the model of the refusal fallback shows at once.
      return { ...view, session: { ...view.session, model: change.model } }
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

type EntryView = SessionSnapshot['entries'][number]
type Step = Extract<EntryView['entry'], { kind: 'plan' }>['steps'][number]

/**
 * The steps of the latest plan entry of the session, or null when the session has no plan or the
 * latest plan has no steps. The plan widget shows these steps (story S8).
 */
export function latestPlan(entries: readonly EntryView[]): Step[] | null {
  const latest = entries.findLast((item) => item.entry.kind === 'plan')?.entry
  return latest?.kind === 'plan' && latest.steps.length > 0 ? latest.steps : null
}

/** The count of the header "Plan N of M": N completed steps of M steps. */
export function planCount(steps: readonly Step[]): { done: number; total: number } {
  return { done: steps.filter((step) => step.status === 'completed').length, total: steps.length }
}

/**
 * The IDs of the plan entries that the transcript marks with "Updated the plan": each plan entry
 * except the first one of the session. The main process writes a new entry only for a new plan, so
 * progress adds no marker.
 */
export function markedPlanIds(entries: readonly EntryView[]): Set<string> {
  const plans = entries.filter((item) => item.entry.kind === 'plan')
  return new Set(plans.slice(1).map((item) => item.id))
}

/**
 * The line of a failed turn or a failed start, and the fold-out under it. The provider writes the
 * last log lines of the agent after the marker line `LOG_MARKER`, for a stopped agent (exit code) and
 * for a start that failed. A notice without the marker stays whole: the sign-in steps stay visible.
 */
export function splitFailedTurn(notice: { text: string }): { line: string; log: string | null } {
  const { message, log } = splitLog(notice.text)
  return { line: message, log }
}

/**
 * The model that the model button shows. The user chose it in a draft, and the window keeps it as
 * view state until the snapshot shows it. After Send the model is fixed, so the choice stays, except
 * after the refusal fallback: the event `model` changes the model of the window, and the window then
 * drops the choice of the draft (see `SessionPage`).
 */
export const shownModel = (chosen: string | null, saved: string): string => chosen ?? saved

/**
 * The mode that the Mode control shows: the mode that the agent reports, else the mode that the user
 * chose in a draft, else the saved mode (spec S5, "Live mode"). The agent beats the choice of the draft.
 */
export const shownMode = <Mode extends string>(live: Mode | null, chosen: Mode | null, saved: Mode): Mode => live ?? chosen ?? saved

/** The oldest open card of the view, by the order of its entry among the entries, or null. */
export function oldestOpenCard(view: Pick<SessionSnapshot, 'entries' | 'permissions' | 'elicitations'>): string | null {
  const open = new Set([...view.permissions.map((item) => item.entryId), ...view.elicitations.map((item) => item.entryId)])
  return view.entries.find((item) => open.has(item.id))?.id ?? null
}

/** True when a scroll area shows the end of its content. The tolerance is for the rounding of the browser. */
export function isAtBottom(area: { scrollTop: number; scrollHeight: number; clientHeight: number }): boolean {
  return area.scrollTop + area.clientHeight >= area.scrollHeight - 2
}
