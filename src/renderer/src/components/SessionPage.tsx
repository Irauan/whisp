import { Loader, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { sendMessage } from '../../../features/sessions/send-message/send-message.contract'
import { setMode } from '../../../features/sessions/set-mode/set-mode.contract'
import { setModel } from '../../../features/sessions/set-model/set-model.contract'
import { stopSession } from '../../../features/sessions/stop/stop.contract'
import { invokeContract } from '../invoke'
import { latestPlan, oldestOpenCard, shownMode, shownModel, type SessionSnapshot } from '../session-view'
import type { Mode } from '../useProfiles'
import { AttachmentIcon } from './AttachmentIcon'
import { Dock } from './Dock'
import { PlanWidget } from './PlanWidget'
import { ReplyComposer } from './ReplyComposer'
import { Transcript, type TranscriptHandle } from './Transcript'

/**
 * A session in its window (brief, Session window). The window is a fixed frame (story S8): the
 * header at the top, the transcript as the only scroll area, and the bottom dock, always in view,
 * with the status line, the plan widget and the composer. The main process owns the conversation:
 * this window shows the snapshot and its events, and sends the commands Send, Stop and the change
 * of the mode and the model of a draft. The composer holds only the text that the user has not sent.
 * `onSettingsSaved` tells the app to load a new snapshot of the sessions, because the mode and the
 * model of a new session depend on the newest one.
 */
export function SessionPage({
  view,
  asking,
  onSettingsSaved,
  onDelete
}: {
  view: SessionSnapshot
  /** True while a question waits for the user. The agent has not started, so the page does not say so. */
  asking: boolean
  onSettingsSaved(): void
  onDelete(): void
}) {
  const { session, status, draft } = view
  // The cards that wait for the user (story S5). They show in the transcript, never in the dock.
  const openCards = view.permissions.length + view.elicitations.length
  // View state: the text of the composer. A draft starts with its prompt (flow 6).
  const [text, setText] = useState(draft ? session.prompt : '')
  // View state: the mode and the model that the user chose in a draft, until the snapshot shows them.
  const [chosenMode, setChosenMode] = useState<Mode | null>(null)
  const [chosenModel, setChosenModel] = useState<string | null>(null)
  // View state: the text of the last command that failed, or null.
  const [problem, setProblem] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  // View state: whether the transcript shows its end. The button "Show request" shows only when it does not.
  const [atBottom, setAtBottom] = useState(true)
  const transcript = useRef<TranscriptHandle>(null)

  // After the refusal fallback the agent moves the session to another model. The choice of a draft
  // then makes way for the model of the window.
  useEffect(() => setChosenModel(null), [session.model])

  // A card also keeps the session busy outside a turn: Stop shows, and the status line says that Claude waits.
  const running = status !== 'idle' || openCards > 0
  const ready = !running && !sending && text.trim() !== ''
  const steps = latestPlan(view.entries)

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

  const showRequest = () => {
    const entryId = oldestOpenCard(view)
    if (entryId !== null) transcript.current?.reveal(entryId)
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
        onSettingsSaved()
      } else {
        // The saved mode stays. Show it again.
        setChosenMode(null)
        setProblem(result.error.message)
      }
    })
  }

  const changeModel = (model: string) => {
    setProblem(null)
    setChosenModel(model)
    void invokeContract(setModel, { id: session.id, model }).then((result) => {
      if (result.ok) {
        // The model that a new session starts with depends on the newest session.
        onSettingsSaved()
      } else {
        setChosenModel(null)
        setProblem(result.error.message)
      }
    })
  }

  // The attachments belong to the first message. They show at the top of the scroll area.
  const attachments =
    session.attachments.length > 0 ? (
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
    ) : null

  return (
    <div className="session-frame">
      <header className="page-head session-head">
        <h1>{session.title}</h1>
        <button type="button" className="icon-button" aria-label="Delete session" title="Delete session" onClick={onDelete}>
          <Trash2 size={18} />
        </button>
      </header>
      {draft ? (
        <div className="session-body">
          {attachments}
          <p className="muted description">This session has not started. Send starts it with the prompt below.</p>
        </div>
      ) : (
        <Transcript
          ref={transcript}
          sessionId={session.id}
          entries={view.entries}
          permissions={view.permissions}
          elicitations={view.elicitations}
          lead={attachments}
          onAtBottom={setAtBottom}
        />
      )}
      <Dock>
        {openCards === 0 && status === 'starting' && !asking && (
          <p className="agent-status muted">
            <Loader size={16} className="spin" aria-hidden="true" />
            <span>Starting Claude Code</span>
          </p>
        )}
        {openCards === 0 && status === 'working' && (
          <p className="agent-status muted">
            <Loader size={16} className="spin" aria-hidden="true" />
            <span>Working</span>
          </p>
        )}
        {openCards > 0 && (
          <p className="agent-status muted">
            <Loader size={16} className="spin" aria-hidden="true" />
            <span>Waiting for your answer</span>
            {!atBottom && (
              <button type="button" className="jump" onClick={showRequest}>
                Show request
              </button>
            )}
          </p>
        )}
        {steps && <PlanWidget steps={steps} />}
        {problem && (
          <p className="error composer-error" role="alert">
            {problem}
          </p>
        )}
        <ReplyComposer
          text={text}
          // The mode that the agent reports (the live mode) beats the choice of the draft.
          mode={shownMode(view.liveMode, chosenMode, session.mode)}
          // The chosen model stays after Send: the snapshot of this window holds the model of its load.
          model={shownModel(chosenModel, session.model)}
          draft={draft}
          running={running}
          ready={ready}
          onText={setText}
          onMode={changeMode}
          onModel={changeModel}
          onSend={send}
          onStop={stop}
        />
      </Dock>
    </div>
  )
}
