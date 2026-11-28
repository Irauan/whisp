import type { Clock } from '../../building-blocks/clock.port'
import type { Ids } from '../../building-blocks/ids'
import type { Elicitation, PermissionRequest } from '../../building-blocks/agent.port'
import type { Mode } from '../../building-blocks/mode'
import { openDecision, openQuestion, permissionView } from './cards'
import {
  failedTool,
  isSamePlan,
  mergeTool,
  planEntry,
  toolEntry,
  type AnswersEntry,
  type Change,
  type ElicitationView,
  type Entry,
  type EntryView,
  type PermissionView,
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

/** A card that waits for the user: its request, and what the main process needs to close it. */
export type OpenCard =
  | { kind: 'permission'; id: string; entryId: string; entry: AnswersEntry; view: PermissionView }
  | { kind: 'elicitation'; id: string; entryId: string; entry: AnswersEntry; view: ElicitationView; keepsText: boolean }

/** The state of a session that the window needs in its snapshot, besides the entries. */
export interface SessionSnapshotState {
  entries: EntryView[]
  status: SessionStatus
  revision: number
  /** The open permission requests, in the order of arrival. */
  permissions: PermissionView[]
  /** The open forms, in the order of arrival. */
  elicitations: ElicitationView[]
  /** The mode that the agent reports, when it differs from the saved mode. Null otherwise. */
  liveMode: Mode | null
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
  /** The open cards of each session, in the order of arrival. Memory only: a restart closes them (architecture, Agents). */
  private readonly cards = new Map<string, OpenCard[]>()
  private readonly liveModes = new Map<string, Mode>()

  /**
   * `cardsClosed` is called after a close that leaves a session with no open card, never for a session
   * that was forgotten. The composition root uses it for the idle time of the release (spec S9).
   */
  constructor(
    private readonly store: SessionStore,
    private readonly publish: (event: SessionEvent) => void,
    private readonly clock: Clock,
    private readonly ids: Ids,
    private readonly cardsClosed: (sessionId: string) => void = () => undefined
  ) {}

  statusOf(sessionId: string): SessionStatus {
    return this.statuses.get(sessionId) ?? 'idle'
  }

  /**
   * The saved entries and the open text, with the status, the open cards and the revision that match
   * them. The entries and the open requests come in one synchronous call, so an entry with the outcome
   * `open` always has its request in the snapshot.
   */
  snapshot(sessionId: string): SessionSnapshotState {
    const entries = this.store.entriesOf(sessionId)
    const open = this.texts.get(sessionId)
    if (open) entries.push({ id: open.id, entry: { kind: open.kind, text: open.text } })
    const cards = this.cards.get(sessionId) ?? []
    return {
      entries,
      status: this.statusOf(sessionId),
      revision: this.revisions.get(sessionId) ?? 0,
      permissions: cards.flatMap((card) => (card.kind === 'permission' ? [card.view] : [])),
      elicitations: cards.flatMap((card) => (card.kind === 'elicitation' ? [card.view] : [])),
      liveMode: this.liveModes.get(sessionId) ?? null
    }
  }

  /** The number of cards that wait for the user. */
  openCardCount(sessionId: string): number {
    return this.cards.get(sessionId)?.length ?? 0
  }

  /** The IDs of the cards that wait for the user, in the order of arrival. */
  openCardIds(sessionId: string): string[] {
    return (this.cards.get(sessionId) ?? []).map((card) => card.id)
  }

  /** The revision of the last event of the session, or 0 when it had none since the start. */
  revisionOf(sessionId: string): number {
    return this.revisions.get(sessionId) ?? 0
  }

  /**
   * Saves the unread mark of the session and tells the window. It acts only when the saved value
   * changes, and never for a session that was forgotten (story S11).
   */
  setUnread(sessionId: string, unread: boolean): void {
    if (this.gone.has(sessionId) || !this.store.setUnread(sessionId, unread)) return
    this.emit(sessionId, { type: 'unread', unread })
  }

  /** The open card of a request, or undefined when it is closed. */
  findCard(sessionId: string, requestId: string): OpenCard | undefined {
    return this.cards.get(sessionId)?.find((card) => card.id === requestId)
  }

  /**
   * A permission request opens a card. The `answers` entry saves at once, with the outcome `open`, after
   * the last entry. The change `card-opened` carries the entry and the request together.
   */
  openPermission(sessionId: string, request: PermissionRequest): void {
    if (this.gone.has(sessionId)) return
    const found = this.store.findTool(sessionId, request.toolId)
    const known = found?.entry.kind === 'tool' ? { title: found.entry.title, toolKind: found.entry.toolKind } : null
    const entryId = this.ids.next()
    const view = permissionView(request, entryId, known)
    this.openCard(sessionId, { kind: 'permission', id: request.id, entryId, entry: openDecision(view), view })
  }

  /** A form opens a card, as `openPermission` does. */
  openElicitation(sessionId: string, form: Elicitation): void {
    if (this.gone.has(sessionId)) return
    const entryId = this.ids.next()
    const view: ElicitationView = { id: form.id, entryId, toolId: form.toolId, message: form.message, fields: form.fields, recommended: form.recommended }
    this.openCard(sessionId, { kind: 'elicitation', id: form.id, entryId, entry: openQuestion(form), view, keepsText: form.keepsText })
  }

  private openCard(sessionId: string, card: OpenCard): void {
    this.flush(sessionId)
    const view: EntryView = { id: card.entryId, entry: card.entry }
    this.store.insertEntry(sessionId, view, this.takePosition(sessionId), this.clock.now().toISOString())
    this.cards.set(sessionId, [...(this.cards.get(sessionId) ?? []), card])
    this.emit(sessionId, { type: 'card-opened', entry: view, card: card.kind === 'permission' ? { kind: 'permission', permission: card.view } : { kind: 'elicitation', elicitation: card.view } })
  }

  /**
   * Closes the card of a request. `final` builds the closed entry from the open one. Every close of a
   * card goes through here, and the first close wins: a card that is not open changes nothing. The same
   * `answers` entry is replaced in place, and the change `card-closed` carries it with the request ID.
   * Returns true when the card closed.
   */
  closeCard(sessionId: string, requestId: string, final: (card: OpenCard) => AnswersEntry): boolean {
    if (this.gone.has(sessionId)) return false
    const card = this.findCard(sessionId, requestId)
    if (!card) return false
    const rest = (this.cards.get(sessionId) ?? []).filter((other) => other !== card)
    if (rest.length === 0) this.cards.delete(sessionId)
    else this.cards.set(sessionId, rest)
    const view: EntryView = { id: card.entryId, entry: final(card) }
    this.store.updateEntry(view)
    this.emit(sessionId, { type: 'card-closed', entry: view, id: requestId })
    if (rest.length === 0) this.cardsClosed(sessionId)
    return true
  }

  /** Closes each open card of a session with one outcome, in the order of arrival. Returns the number of cards that closed. */
  closeAllCards(sessionId: string, final: (card: OpenCard) => AnswersEntry): number {
    let closed = 0
    for (const card of [...(this.cards.get(sessionId) ?? [])]) if (this.closeCard(sessionId, card.id, final)) closed += 1
    return closed
  }

  /** The IDs of the sessions that have an open card. */
  sessionsWithCards(): string[] {
    return [...this.cards.keys()]
  }

  /** The mode that the agent reports now, or null when the window shows the saved mode. */
  liveModeOf(sessionId: string): Mode | null {
    return this.liveModes.get(sessionId) ?? null
  }

  /** The agent uses a mode that differs from the one that the window shows. Tells the window. */
  setLiveMode(sessionId: string, mode: Mode): void {
    if (this.gone.has(sessionId)) return
    this.liveModes.set(sessionId, mode)
    this.emit(sessionId, { type: 'mode', mode })
  }

  /** The process of the session is gone, so its live mode is too. The window then shows the saved mode again. */
  clearLiveMode(sessionId: string, savedMode: Mode | undefined): void {
    if (this.gone.has(sessionId) || !this.liveModes.delete(sessionId) || savedMode === undefined) return
    this.emit(sessionId, { type: 'mode', mode: savedMode })
  }

  /** The session uses another model now. Tells the window. */
  setModel(sessionId: string, model: string): void {
    if (this.gone.has(sessionId)) return
    this.emit(sessionId, { type: 'model', model })
  }

  /** The session has another title now. The caller saved it first. Tells the window. */
  setTitle(sessionId: string, title: string): void {
    if (this.gone.has(sessionId)) return
    this.emit(sessionId, { type: 'title', title })
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
    for (const map of [this.revisions, this.statuses, this.texts, this.positions, this.cards, this.liveModes]) map.delete(sessionId)
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
