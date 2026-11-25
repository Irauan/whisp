import { ArrowUp } from 'lucide-react'
import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { parseRequest } from '../../../shared/model'

interface Props {
  projectId: string
  onSubmit(projectId: string, request: { title: string; description: string }): void
}

/** Creates work items. */
export function Composer({ projectId, onSubmit }: Props) {
  const [text, setText] = useState('')
  const request = parseRequest(text)

  const submit = () => {
    if (!request) return
    onSubmit(projectId, request)
    setText('')
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    submit()
  }

  const onFormSubmit = (event: FormEvent) => {
    event.preventDefault()
    submit()
  }

  return (
    <form className="composer" onSubmit={onFormSubmit}>
      <div className="composer-box">
        <textarea
          aria-label="Describe the work"
          placeholder="Describe the work to do. Aether creates a work item."
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="composer-actions">
          <span className="hint">Enter to create, Shift+Enter for a new line</span>
          <button type="submit" className="send" aria-label="Create work item" disabled={!request}>
            <ArrowUp size={20} />
          </button>
        </div>
      </div>
    </form>
  )
}
