import { Check, CircleDashed, Info, Loader, X } from 'lucide-react'
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type ReactNode, type Ref } from 'react'
import { isAtBottom, markedPlanIds, splitFailedTurn, type SessionSnapshot } from '../session-view'
import { ElicitationCard, AnsweredQuestion } from './ElicitationCard'
import { AnsweredDecision, PermissionCard } from './PermissionCard'

type EntryView = SessionSnapshot['entries'][number]
type Entry = EntryView['entry']
type Tool = Extract<Entry, { kind: 'tool' }>

const TOOL_STATUS: Record<Tool['status'], string> = {
  pending: 'Pending',
  in_progress: 'Running',
  completed: 'Completed',
  failed: 'Failed'
}

function ToolIcon({ status }: { status: Tool['status'] }) {
  switch (status) {
    case 'completed':
      return <Check size={14} aria-hidden="true" />
    case 'failed':
      return <X size={14} aria-hidden="true" />
    case 'in_progress':
      return <Loader size={14} className="spin" aria-hidden="true" />
    case 'pending':
      return <CircleDashed size={14} aria-hidden="true" />
  }
}

/**
 * A failed turn: one muted line with an info icon, at its point in the transcript. It keeps the role
 * `alert`. The last log lines of the agent, if the notice has them, are in a fold-out that starts closed.
 * The log stays in the text of the alert.
 */
function FailedLine({ entry }: { entry: Extract<Entry, { kind: 'notice' }> }) {
  const { line, log } = splitFailedTurn(entry)
  return (
    <div role="alert" className="notice failed-line">
      <Info size={16} aria-hidden="true" />
      <div className="failed-body">
        <p>{line}</p>
        {log !== null && (
          <details>
            <summary>Show log</summary>
            <pre>{log}</pre>
          </details>
        )}
      </div>
    </div>
  )
}

/** What a row needs to draw a card: the open requests of the session, in place of their entries. */
interface Cards {
  sessionId: string
  permissions: SessionSnapshot['permissions']
  elicitations: SessionSnapshot['elicitations']
}

function EntryRow({ id, entry, marked, cards }: { id: string; entry: Entry; marked: boolean; cards: Cards }) {
  switch (entry.kind) {
    case 'user':
      return (
        <div className="msg user">
          <p>{entry.text}</p>
        </div>
      )
    case 'agent':
      return (
        <div className="msg">
          <p>{entry.text}</p>
        </div>
      )
    case 'thought':
      return (
        <details className="msg thought">
          <summary>Thought</summary>
          <p>{entry.text}</p>
        </details>
      )
    case 'tool':
      return (
        <div
          role="group"
          aria-label={entry.title}
          className={`tool ${entry.status === 'completed' ? 'tool-done' : entry.status === 'failed' ? 'tool-failed' : ''}`}
        >
          <ToolIcon status={entry.status} />
          <span className="tool-title">{entry.title}</span>
          <span className="tool-status">{TOOL_STATUS[entry.status]}</span>
        </div>
      )
    case 'plan':
      // The plan widget of the dock shows the steps. The transcript marks only a new plan: the first
      // plan of the session and the progress of a plan add no marker (story S8).
      return marked ? <p className="notice">Updated the plan</p> : null
    case 'notice':
      return entry.tone === 'error' ? <FailedLine entry={entry} /> : <p className="notice">{entry.text}</p>
    case 'answers': {
      // An open card shows as the live card of its request, never from the entry alone. A closed card, and
      // an entry that no request holds, show from the entry (spec S5, "How a live card and its entry connect").
      const permission = cards.permissions.find((item) => item.entryId === id)
      if (permission) return <PermissionCard sessionId={cards.sessionId} view={permission} entry={entry} />
      const form = cards.elicitations.find((item) => item.entryId === id)
      if (form) return <ElicitationCard sessionId={cards.sessionId} view={form} entry={entry} />
      return entry.card === 'decision' ? <AnsweredDecision entry={entry} /> : <AnsweredQuestion entry={entry} />
    }
  }
}

/** What the window can ask of the transcript. */
export interface TranscriptHandle {
  /** Brings the open card of an entry into view and moves the focus to it. */
  reveal(entryId: string): void
}

/**
 * The conversation of a session: user text, agent text, thoughts (folded), tool calls with their
 * status, and notices. The log is the scroll element of the session window and the only one. It
 * follows new entries and streamed text while it shows the end. When the user scrolls up, it keeps
 * the position. When the user scrolls back to the end, it follows again. `lead` shows before the
 * first entry, inside the log. The cards of the agent (story S5) show in the log at the place of their
 * entry. `onAtBottom` tells the window when the log shows its end or not, for the button "Show request".
 */
export function Transcript({
  sessionId,
  entries,
  permissions,
  elicitations,
  lead,
  onAtBottom,
  ref
}: {
  sessionId: string
  entries: EntryView[]
  permissions: SessionSnapshot['permissions']
  elicitations: SessionSnapshot['elicitations']
  lead?: ReactNode
  onAtBottom?(atBottom: boolean): void
  ref?: Ref<TranscriptHandle>
}) {
  const log = useRef<HTMLDivElement>(null)
  // True while the log shows its end. Only a scroll of the log changes it.
  const following = useRef(true)
  const marked = markedPlanIds(entries)
  const cards: Cards = { sessionId, permissions, elicitations }

  useImperativeHandle(ref, () => ({
    reveal(entryId) {
      const card = log.current?.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(entryId)}"]`)
      if (!card) return
      card.scrollIntoView({ block: 'center' })
      card.focus()
    }
  }))

  const toEnd = () => {
    const element = log.current
    if (element) element.scrollTop = element.scrollHeight
  }

  // New entries and streamed text arrive as a new `entries` array.
  useLayoutEffect(() => {
    if (following.current) toEnd()
  }, [entries])

  // The dock grows and shrinks (the plan, the status line, a long prompt), and the log with it.
  useEffect(() => {
    const element = log.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      if (following.current) toEnd()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={log}
      role="log"
      aria-label="Transcript"
      className="transcript"
      onScroll={(event) => {
        const atBottom = isAtBottom(event.currentTarget)
        if (atBottom !== following.current) onAtBottom?.(atBottom)
        following.current = atBottom
      }}
    >
      {lead}
      {entries.map((item) => (
        <EntryRow key={item.id} id={item.id} entry={item.entry} marked={marked.has(item.id)} cards={cards} />
      ))}
    </div>
  )
}
