import { Check, CircleDashed, Info, Loader, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { isAtBottom, markedPlanIds, splitFailedTurn, type SessionSnapshot } from '../session-view'

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

function EntryRow({ entry, marked }: { entry: Entry; marked: boolean }) {
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
  }
}

/**
 * The conversation of a session: user text, agent text, thoughts (folded), tool calls with their
 * status, and notices. The log is the scroll element of the session window and the only one. It
 * follows new entries and streamed text while it shows the end. When the user scrolls up, it keeps
 * the position. When the user scrolls back to the end, it follows again. `lead` shows before the
 * first entry, inside the log.
 */
export function Transcript({ entries, lead }: { entries: EntryView[]; lead?: ReactNode }) {
  const log = useRef<HTMLDivElement>(null)
  // True while the log shows its end. Only a scroll of the log changes it.
  const following = useRef(true)
  const marked = markedPlanIds(entries)

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
        following.current = isAtBottom(event.currentTarget)
      }}
    >
      {lead}
      {entries.map((item) => (
        <EntryRow key={item.id} entry={item.entry} marked={marked.has(item.id)} />
      ))}
    </div>
  )
}
