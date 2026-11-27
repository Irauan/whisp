import { ArrowUp, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { labelOf, MODELS } from '../../../shared/model'
import type { SessionView } from '../useProfiles'
import { AttachmentIcon } from './AttachmentIcon'
import { ModeMenu } from './ModeMenu'

const SEND_UNAVAILABLE = 'Send is coming soon. Aether cannot run sessions yet.'

/**
 * A session in its window. Until the chat story, every session is a draft: the composer holds
 * the prompt and the mode of the session, and Send waits. The user can edit both, but Aether does
 * not save the change: no slice saves it yet.
 */
export function SessionPage({ session, onDelete }: { session: SessionView; onDelete(): void }) {
  // View state: the text of the composer. The user can edit it, and Aether does not save it.
  const [text, setText] = useState(session.prompt)
  // View state: the mode in the Mode control, like the text.
  const [mode, setMode] = useState(session.mode)
  const rows: [string, string][] = [
    ['Folder', session.sourcePath],
    ['Model', labelOf(MODELS, session.model)]
  ]

  return (
    <div className="page">
      <header className="page-head">
        <h1>{session.title}</h1>
        <button type="button" className="icon-button" aria-label="Delete session" title="Delete session" onClick={onDelete}>
          <Trash2 size={18} />
        </button>
      </header>
      <p className="muted description">Aether saved this session as a draft. Aether cannot run sessions yet.</p>
      <dl className="facts">
        {rows.map(([name, value]) => (
          <div key={name}>
            <dt className="muted">{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
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
      <form className="composer" onSubmit={(event) => event.preventDefault()}>
        <div className="composer-box">
          <textarea aria-label="Prompt" rows={3} value={text} onChange={(event) => setText(event.target.value)} />
          <div className="composer-actions session-actions">
            <ModeMenu mode={mode} onChange={setMode} />
            <span className="spacer" />
            <button type="submit" className="send" aria-label="Send" title={SEND_UNAVAILABLE} disabled>
              <ArrowUp size={20} />
            </button>
          </div>
        </div>
        <p className="muted composer-error">{SEND_UNAVAILABLE}</p>
      </form>
    </div>
  )
}
