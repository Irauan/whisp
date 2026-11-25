import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AccountContent } from '../../../shared/model'
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

export function NewProjectDialog(props: { onClose(): void; onCreate(name: string): void }) {
  const [name, setName] = useState('')
  const trimmed = name.trim()
  return (
    <Modal label="New project" onClose={props.onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (trimmed) props.onCreate(trimmed)
        }}
      >
        <h2>New project</h2>
        <label className="field">
          Name
          <input
            value={name}
            maxLength={80}
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <p className="muted">A project does not need a repository.</p>
        <div className="dialog-actions">
          <button type="button" className="button" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={!trimmed}>
            Create project
          </button>
        </div>
      </form>
    </Modal>
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
  content: AccountContent
  onClose(): void
  onGo(view: View): void
}) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const { projects, workItems, sessions } = props.content

  const results: { key: string; title: string; note: string; view: View }[] = [
    ...projects.map((project) => ({
      key: project.id,
      title: project.name,
      note: 'Project',
      view: { kind: 'project', projectId: project.id } as const
    })),
    ...workItems.map((item) => ({
      key: item.id,
      title: item.title,
      note: projects.find((project) => project.id === item.projectId)?.name ?? '',
      view: { kind: 'item', itemId: item.id } as const
    })),
    ...sessions.map((session) => ({
      key: session.id,
      title: session.title,
      note: 'Session',
      view: { kind: 'session', sessionId: session.id } as const
    }))
  ]
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
          aria-label="Search projects, work items and sessions"
          placeholder="Search projects, work items and sessions"
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
