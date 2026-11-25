import { Trash2 } from 'lucide-react'
import { labelOf, MODELS, MODES, PERMISSIONS, type Session } from '../../../shared/model'
import { AttachmentIcon } from './AttachmentIcon'

export function SessionPage({ session, onDelete }: { session: Session; onDelete(): void }) {
  const { settings } = session
  const rows: [string, string][] = [
    ['Folder', settings.folder],
    ['Worktree', settings.checkout === 'worktree' ? 'New worktree' : 'Folder as it is'],
    ['Runs on', 'This computer'],
    ['Mode', labelOf(MODES, settings.mode)],
    ['Tool permissions', labelOf(PERMISSIONS, settings.permissions)],
    ['Model', labelOf(MODELS, settings.model)]
  ]

  return (
    <div className="page">
      <header className="page-head">
        <h1>{session.title}</h1>
        <button type="button" className="icon-button" aria-label="Delete session" onClick={onDelete}>
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
      {settings.attachments.length > 0 && (
        <section className="panel">
          <h2>Attachments</h2>
          <ul>
            {settings.attachments.map((item) => (
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
