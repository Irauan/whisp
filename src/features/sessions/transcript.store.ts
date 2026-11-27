import type { Clock } from '../../building-blocks/clock.port'
import type { Ids } from '../../building-blocks/ids'
import {
  failedTool,
  isSamePlan,
  mergeTool,
  planEntry,
  toolEntry,
  type Change,
  type Entry,
  type EntryView,
  type SessionEvent,
  type SessionStatus,
  type TextKind
} from './entry'
import type { AgentUpdate } from '../../building-blocks/agent.port'
import type { SessionStore } from './session.store'

/** Streamed text that the agent has not finished. The transcript saves it as one row when the entry closes. */
interface OpenText {
  id: string
  kind: TextKind
  position: number
  text: string
}

/**
 * The conversation of each session, as the main process owns it (decision 0002). It saves each
 * entry as one row, joins streamed text before it saves the text, and tells the renderer each
 * change as an event with a revision. The status and the revisions live in memory only.
 *
 * Every call is synchronous, so a snapshot and the revision that goes with it never disagree.
 */
export class Transcript {
  private readonly revisions = new Map<string, number>()
  private readonly statuses = new Map<string, SessionStatus>()
  private readonly texts = new Map<string, OpenText>()
  private readonly positions = new Map<string, number>()
  private readonly gone = new Set<string>()

  constructor(
    private readonly store: SessionStore,
    private readonly publish: (event: SessionEvent) => void,
    private readonly clock: Clock,
    private readonly ids: Ids
  ) {}

  statusOf(sessionId: string): SessionStatus {
    return this.statuses.get(sessionId) ?? 'idle'
  }

  /** The saved entries and the open text, with the status and the revision that match them. */
  snapshot(sessionId: string): { entries: EntryView[]; status: SessionStatus; revision: number } {
    const entries = this.store.entriesOf(sessionId)
    const open = this.texts.get(sessionId)
    if (open) entries.push({ id: open.id, entry: { kind: open.kind, text: open.text } })
    return { entries, status: this.statusOf(sessionId), revision: this.revisions.get(sessionId) ?? 0 }
  }

  setStatus(sessionId: string, status: SessionStatus): void {
    if (this.gone.has(sessionId) || this.statusOf(sessionId) === status) return
    this.statuses.set(sessionId, status)
    this.emit(sessionId, { type: 'status', status })
  }

  /** Adds an entry after the last one. The open text closes first, so the order stays. */
  addEntry(sessionId: string, entry: Entry): EntryView | null {
    if (this.gone.has(sessionId)) return null
    this.flush(sessionId)
    const view: EntryView = { id: this.ids.next(), entry }
    this.store.insertEntry(sessionId, view, this.takePosition(sessionId), this.clock.now().toISOString())
    this.emit(sessionId, { type: 'entry-added', entry: view })
    return view
  }

  /** Adds streamed text. It joins the open text of the same kind, and saves nothing until the text closes. */
  addText(sessionId: string, kind: TextKind, text: string): void {
    if (this.gone.has(sessionId) || text === '') return
    const open = this.texts.get(sessionId)
    if (open?.kind === kind) {
      open.text += text
      this.emit(sessionId, { type: 'entry-text', id: open.id, text })
      return
    }
    this.flush(sessionId)
    const created: OpenText = { id: this.ids.next(), kind, position: this.takePosition(sessionId), text }
    this.texts.set(sessionId, created)
    this.emit(sessionId, { type: 'entry-added', entry: { id: created.id, entry: { kind, text } } })
  }

  /** Saves the open text as one entry. */
  flush(sessionId: string): void {
    const open = this.texts.get(sessionId)
    if (!open) return
    this.texts.delete(sessionId)
    if (this.gone.has(sessionId)) return
    this.store.insertEntry(sessionId, { id: open.id, entry: { kind: open.kind, text: open.text } }, open.position, this.clock.now().toISOString())
  }

  /** A tool call that the agent announces. A second announcement of the same call replaces the first. */
  announceTool(sessionId: string, update: Extract<AgentUpdate, { type: 'tool' }>): void {
    if (this.gone.has(sessionId)) return
    this.flush(sessionId)
    const known = this.store.findTool(sessionId, update.id)
    if (!known) {
      this.addEntry(sessionId, toolEntry(update))
      return
    }
    this.replace(sessionId, { id: known.id, entry: toolEntry(update) })
  }

  /** A change of a tool call. An update for a call that Aether does not know changes nothing. */
  updateTool(sessionId: string, update: Extract<AgentUpdate, { type: 'tool-update' }>): void {
    if (this.gone.has(sessionId)) return
    this.flush(sessionId)
    const known = this.store.findTool(sessionId, update.id)
    if (known?.entry.kind !== 'tool') return
    this.replace(sessionId, { id: known.id, entry: mergeTool(known.entry, update) })
  }

  /**
   * A plan of the agent, with all its steps. The same step texts in the same order are progress:
   * the latest plan entry of the session changes in place, with its ID and its position. Any other
   * plan is a new plan, and it adds an entry. Both close the open text first, as `updateTool` does.
   */
  addPlan(sessionId: string, update: Extract<AgentUpdate, { type: 'plan' }>): void {
    if (this.gone.has(sessionId)) return
    this.flush(sessionId)
    const next = planEntry(update)
    const latest = this.store.latestPlan(sessionId)
    if (latest?.entry.kind === 'plan' && isSamePlan(latest.entry, next)) {
      this.replace(sessionId, { id: latest.id, entry: next })
      return
    }
    this.addEntry(sessionId, next)
  }

  /** Marks each tool call that did not finish as failed, for example after a stop or a crash. */
  failOpenTools(sessionId: string): void {
    if (this.gone.has(sessionId)) return
    for (const view of this.store.openTools(sessionId)) {
      if (view.entry.kind === 'tool') this.replace(sessionId, { id: view.id, entry: failedTool(view.entry) })
    }
  }

  /** The session no longer exists. Nothing more is saved or sent for it. */
  forget(sessionId: string): void {
    this.gone.add(sessionId)
    for (const map of [this.revisions, this.statuses, this.texts, this.positions]) map.delete(sessionId)
  }

  private replace(sessionId: string, view: EntryView): void {
    this.store.updateEntry(view)
    this.emit(sessionId, { type: 'entry-replaced', entry: view })
  }

  private takePosition(sessionId: string): number {
    const next = this.positions.get(sessionId) ?? this.store.nextPosition(sessionId)
    this.positions.set(sessionId, next + 1)
    return next
  }

  private emit(sessionId: string, change: Change): void {
    const revision = (this.revisions.get(sessionId) ?? 0) + 1
    this.revisions.set(sessionId, revision)
    this.publish({ sessionId, revision, change })
  }
}
