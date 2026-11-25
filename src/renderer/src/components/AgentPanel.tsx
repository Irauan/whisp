import {
  ArrowUp,
  Check,
  ChevronDown,
  Circle,
  CircleAlert,
  FolderOpen,
  LoaderCircle,
  Square,
  SquareCheck,
  X
} from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ChatEntry, PermissionQuestion, ToolStatus } from '../../../shared/agent'
import type { Project, WorkItem } from '../../../shared/model'
import { useAgentRun, useAgents } from '../useAgentRun'

const LAST_AGENT = 'aether.last-agent'

function rememberedAgent(): string | null {
  try {
    return localStorage.getItem(LAST_AGENT)
  } catch {
    return null
  }
}

function rememberAgent(id: string): void {
  try {
    localStorage.setItem(LAST_AGENT, id)
  } catch {
    // Only a convenience.
  }
}

export function AgentPanel(props: { item: WorkItem; project: Project; onChooseFolder(): void }) {
  const { item, project } = props
  const { run, error, setError } = useAgentRun(item.id)
  const agents = useAgents()
  const [chosen, setChosen] = useState<string | null>(null)
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)

  const available = agents?.filter((agent) => agent.available) ?? []
  const preferred = [chosen, run.agentId, rememberedAgent()].find((id) =>
    available.some((agent) => agent.id === id)
  )
  const agentId = preferred ?? available[0]?.id ?? null
  const busy = run.status === 'starting' || run.status === 'working'
  const canSend = Boolean(agentId && project.path && !busy)

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [run.entries.length, run.entries.at(-1), run.question])

  const send = (message: string) => {
    if (!agentId || !project.path || !message.trim()) return
    setError(null)
    rememberAgent(agentId)
    window.aether
      .sendToAgent({ itemId: item.id, agentId, cwd: project.path, text: message })
      .catch((cause: unknown) => setError(String(cause).replace(/^Error: (Error invoking remote method '[^']+': )?(Error: )?/, '')))
  }

  const submit = () => {
    if (!canSend || !text.trim()) return
    send(text)
    setText('')
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    submit()
  }

  const brief = [item.title, item.description].filter(Boolean).join('\n\n')

  return (
    <section className="panel agent-panel" aria-label="Agent">
      <header className="agent-head">
        <h2>Agent</h2>
        <span className="spacer" />
        {agents && available.length > 0 && (
          <label className="picker">
            <select
              aria-label="Agent"
              value={agentId ?? ''}
              disabled={busy}
              onChange={(event) => setChosen(event.target.value)}
            >
              {available.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>
        )}
      </header>

      {!project.path && (
        <div className="agent-empty">
          <p className="muted">Agents work in the project's folder. This project has no folder yet.</p>
          <button type="button" className="button" onClick={props.onChooseFolder}>
            <FolderOpen size={16} />
            Choose folder
          </button>
        </div>
      )}
      {agents && available.length === 0 && (
        <p className="muted">
          Aether found no agent on this machine.
          {agents.map((agent) => ` ${agent.name}: ${agent.detail}`).join('.')}
        </p>
      )}

      {run.entries.length > 0 && (
        <ol className="transcript">
          {run.entries.map((entry, index) => (
            <Entry key={index} entry={entry} />
          ))}
        </ol>
      )}

      {run.question && (
        <Question
          question={run.question}
          onAnswer={(choiceId) => void window.aether.answerAgent(item.id, choiceId)}
        />
      )}
      {busy && !run.question && (
        <p className="agent-status muted">
          <LoaderCircle size={14} className="spin" />
          {run.status === 'starting' ? 'Starting the agent' : 'Working'}
        </p>
      )}
      {error && (
        <p className="notice error-notice" role="alert">
          {error}
        </p>
      )}
      <div ref={end} />

      {run.entries.length === 0 && project.path && agentId && !busy && (
        <button type="button" className="button primary start" onClick={() => send(brief)}>
          Start with this work item
        </button>
      )}

      <form
        className="composer agent-composer"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="composer-box">
          <textarea
            aria-label="Message to the agent"
            placeholder={project.path ? 'Message the agent' : 'Choose a folder first'}
            rows={2}
            value={text}
            disabled={!project.path}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="composer-actions">
            <span className="hint">{project.path}</span>
            {busy ? (
              <button
                type="button"
                className="send"
                aria-label="Stop the agent"
                onClick={() => void window.aether.cancelAgent(item.id)}
              >
                <Square size={14} fill="currentColor" />
              </button>
            ) : (
              <button type="submit" className="send" aria-label="Send" disabled={!canSend || !text.trim()}>
                <ArrowUp size={20} />
              </button>
            )}
          </div>
        </div>
      </form>
    </section>
  )
}

function ToolIcon({ status }: { status: ToolStatus }) {
  switch (status) {
    case 'completed':
      return <Check size={14} className="tool-done" />
    case 'failed':
      return <X size={14} className="tool-failed" />
    case 'in_progress':
      return <LoaderCircle size={14} className="spin" />
    default:
      return <Circle size={14} />
  }
}

function Entry({ entry }: { entry: ChatEntry }) {
  switch (entry.kind) {
    case 'user':
      return <li className="msg user">{entry.text}</li>
    case 'agent':
      return <li className="msg agent">{entry.text}</li>
    case 'thought':
      return (
        <li className="msg thought">
          <details>
            <summary>Thinking</summary>
            {entry.text}
          </details>
        </li>
      )
    case 'tool':
      return (
        <li className={`tool tool-${entry.status}`}>
          <ToolIcon status={entry.status} />
          <span className="tool-title">{entry.title}</span>
        </li>
      )
    case 'plan':
      return (
        <li className="plan">
          <ul>
            {entry.steps.map((step, index) => (
              <li key={index} className={step.done ? 'done' : undefined}>
                {step.done ? <SquareCheck size={14} /> : <Square size={14} />}
                {step.text}
              </li>
            ))}
          </ul>
        </li>
      )
    case 'notice':
      return (
        <li className={entry.tone === 'error' ? 'notice error-notice' : 'notice'}>
          {entry.tone === 'error' && <CircleAlert size={14} />}
          {entry.text}
        </li>
      )
  }
}

function Question(props: { question: PermissionQuestion; onAnswer(choiceId: string | null): void }) {
  const { question } = props
  return (
    <div className="question" role="group" aria-label="The agent asks for permission">
      <p>
        <strong>Allow?</strong> {question.title}
      </p>
      <div className="question-actions">
        {question.choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            className={choice.kind.startsWith('allow') ? 'button primary' : 'button'}
            onClick={() => props.onAnswer(choice.id)}
          >
            {choice.name}
          </button>
        ))}
        {question.choices.length === 0 && (
          <button type="button" className="button" onClick={() => props.onAnswer(null)}>
            Refuse
          </button>
        )}
      </div>
    </div>
  )
}
