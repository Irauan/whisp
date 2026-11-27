import { Check, CircleDashed, Loader, X } from 'lucide-react'
import type { SessionSnapshot } from '../session-view'

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

function EntryRow({ entry }: { entry: Entry }) {
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
      // Story S8 shows the plan as a todo list above the composer. The transcript only marks the update.
      return <p className="notice">Updated the plan</p>
    case 'notice':
      return entry.tone === 'error' ? (
        <p role="alert" className="notice error-notice">
          {entry.text}
        </p>
      ) : (
        <p className="notice">{entry.text}</p>
      )
  }
}

/** The conversation of a session: user text, agent text, thoughts (folded), tool calls with their status, and notices. */
export function Transcript({ entries }: { entries: EntryView[] }) {
  return (
    <div role="log" aria-label="Transcript" className="transcript">
      {entries.map((item) => (
        <EntryRow key={item.id} entry={item.entry} />
      ))}
    </div>
  )
}
