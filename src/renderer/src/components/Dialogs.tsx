import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SessionDraft } from '../useProfiles'
import type { View } from '../navigation'

export function Modal(props: { label: string; className?: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      className={props.className}
      aria-label={props.label}
      onClose={props.onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose()
      }}
    >
      <div className="dialog-body">{props.children}</div>
    </dialog>
  )
}

export function ConfirmDialog(props: {
  title: string
  body: string
  confirmLabel: string
  onClose(): void
  onConfirm(): void
}) {
  return (
    <Modal label={props.title} onClose={props.onClose}>
      <h2>{props.title}</h2>
      <p className="muted">{props.body}</p>
      <div className="dialog-actions">
        <button type="button" className="button" autoFocus onClick={props.onClose}>
          Cancel
        </button>
        <button type="button" className="button danger" onClick={props.onConfirm}>
          {props.confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

export function SearchDialog(props: {
  sessions: SessionDraft[]
  onClose(): void
  onGo(view: View): void
}) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const { sessions } = props

  const results: { key: string; title: string; note: string; view: View }[] = sessions
    .map((session) => ({
      key: session.id,
      title: session.title,
      note: 'Session',
      view: { kind: 'session', sessionId: session.id } as const
    }))
    .filter((result) => result.title.toLowerCase().includes(needle))
    .slice(0, 20)

  return (
    <Modal label="Search" className="search" onClose={props.onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const [first] = results
          if (first) props.onGo(first.view)
        }}
      >
        <input
          aria-label="Search sessions"
          placeholder="Search sessions"
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
        />
      </form>
      <ul>
        {results.map((result) => (
          <li key={result.key}>
            <button type="button" className="row" onClick={() => props.onGo(result.view)}>
              <span className="row-label">{result.title}</span>
              <span className="row-note">{result.note}</span>
            </button>
          </li>
        ))}
      </ul>
      {results.length === 0 && <p className="empty-row">No results</p>}
    </Modal>
  )
}
