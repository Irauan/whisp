import { Trash2 } from 'lucide-react'
import { labelOf, MODELS } from '../../../shared/model'
import type { SessionDraft } from '../useWorkspaces'
import { AttachmentIcon } from './AttachmentIcon'

/** The five modes of a session. Story S3 of m1-chat replaces this with the Mode control. */
const MODE_LABELS = [
  { id: 'ask', label: 'Ask' },
  { id: 'accept-edits', label: 'Accept edits' },
  { id: 'plan', label: 'Plan' },
  { id: 'auto', label: 'Auto' },
  { id: 'approve-all', label: 'Approve all' }
] as const

/** A draft session of the import. It is read-only until the session slices of story S3 exist. */
export function SessionPage({ session }: { session: SessionDraft }) {
  const rows: [string, string][] = [
    ['Folder', session.folder],
    ['Mode', labelOf(MODE_LABELS, session.mode)],
    ['Model', labelOf(MODELS, session.model)]
  ]

  return (
    <div className="page">
      <header className="page-head">
        <h1>{session.title}</h1>
        <button
          type="button"
          className="icon-button"
          aria-label="Delete session"
          title="Coming soon"
          disabled
        >
          <Trash2 size={18} />
        </button>
      </header>
      <p className="muted description">
        Aether saved this session as a draft. Aether cannot run sessions yet.
      </p>
      <section className="panel">
        <h2>Prompt</h2>
        <p className="prompt">{session.prompt}</p>
      </section>
      <section className="panel">
        <h2>Settings</h2>
        <dl className="facts">
          {rows.map(([name, value]) => (
            <div key={name}>
              <dt className="muted">{name}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      {session.attachments.length > 0 && (
        <section className="panel">
          <h2>Attachments</h2>
          <ul>
            {session.attachments.map((item) => (
              <li key={item.kind + item.ref} className="attachment" title={item.ref}>
                <AttachmentIcon kind={item.kind} size={16} />
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
