import { ArrowUp, Loader, Square, Trash2 } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { sendMessage } from '../../../features/sessions/send-message/send-message.contract'
import { setMode } from '../../../features/sessions/set-mode/set-mode.contract'
import { stopSession } from '../../../features/sessions/stop/stop.contract'
import { labelOf, MODELS } from '../../../shared/model'
import { invokeContract } from '../invoke'
import type { SessionSnapshot } from '../session-view'
import type { Mode } from '../useProfiles'
import { AttachmentIcon } from './AttachmentIcon'
import { ModeMenu } from './ModeMenu'
import { Transcript } from './Transcript'

/**
 * A session in its window (brief, Session window). The main process owns the conversation: this
 * window shows the snapshot and its events, and sends the commands Send, Stop and the change of
 * the mode of a draft. The composer holds only the text that the user has not sent.
 * `onModeSaved` tells the app to load a new snapshot of the sessions, because the mode of a new
 * session depends on the newest one.
 */
export function SessionPage({
  view,
  profileName,
  onModeSaved,
  onDelete
}: {
  view: SessionSnapshot
  /** The name of the profile of the session, or null when the profile is not known. */
  profileName: string | null
  onModeSaved(): void
  onDelete(): void
}) {
  const { session, status, draft } = view
  // View state: the text of the composer. A draft starts with its prompt (flow 6).
  const [text, setText] = useState(draft ? session.prompt : '')
  // View state: the mode that the user chose in a draft, until the snapshot shows it.
  const [chosenMode, setChosenMode] = useState<Mode | null>(null)
  // View state: the text of the last command that failed, or null.
  const [problem, setProblem] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const running = status !== 'idle'
  const ready = !running && !sending && text.trim() !== ''
  const rows: [string, string][] = [
    ...(profileName === null ? [] : ([['Profile', profileName]] as [string, string][])),
    ['Folder', session.sourcePath],
    ['Model', labelOf(MODELS, session.model)]
  ]

  const send = () => {
    if (!ready) return
    setSending(true)
    setProblem(null)
    void invokeContract(sendMessage, { id: session.id, text }).then((result) => {
      setSending(false)
      if (result.ok) setText('')
      else setProblem(result.error.message)
    })
  }

  const stop = () => {
    void invokeContract(stopSession, { id: session.id }).then((result) => {
      if (!result.ok) setProblem(result.error.message)
    })
  }

  const changeMode = (mode: Mode) => {
    setProblem(null)
    setChosenMode(mode)
    void invokeContract(setMode, { id: session.id, mode }).then((result) => {
      if (result.ok) {
        // The mode that a new session starts with depends on the newest session (decision 0012).
        onModeSaved()
      } else {
        // The saved mode stays. Show it again.
        setChosenMode(null)
        setProblem(result.error.message)
      }
    })
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    send()
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>{session.title}</h1>
        <button type="button" className="icon-button" aria-label="Delete session" title="Delete session" onClick={onDelete}>
          <Trash2 size={18} />
        </button>
      </header>
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
      {draft ? (
        <p className="muted description">This session has not started. Send starts it with the prompt below.</p>
      ) : (
        <Transcript entries={view.entries} />
      )}
      {status === 'starting' && (
        <p className="agent-status muted">
          <Loader size={16} className="spin" aria-hidden="true" />
          <span>Starting Claude Code</span>
        </p>
      )}
      {status === 'working' && (
        <p className="agent-status muted">
          <Loader size={16} className="spin" aria-hidden="true" />
          <span>Working</span>
        </p>
      )}
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault()
          send()
        }}
      >
        <div className="composer-box">
          <textarea aria-label="Prompt" rows={3} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={onKeyDown} />
          <div className="composer-actions session-actions">
            <ModeMenu mode={chosenMode ?? session.mode} disabled={!draft} onChange={changeMode} />
            <span className="spacer" />
            {running ? (
              <button type="button" className="send" aria-label="Stop" title="Stop" onClick={stop}>
                <Square size={16} />
              </button>
            ) : (
              <button type="submit" className="send" aria-label="Send" title="Send" disabled={!ready}>
                <ArrowUp size={20} />
              </button>
            )}
          </div>
        </div>
        {problem && (
          <p className="error composer-error" role="alert">
            {problem}
          </p>
        )}
      </form>
    </div>
  )
}
