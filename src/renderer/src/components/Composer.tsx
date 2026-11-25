import { ArrowUp, ChevronDown, Compass, Plus } from 'lucide-react'
import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { parseRequest, type Project } from '../../../shared/model'

interface Props {
  projects: Project[]
  /** When set, the composer adds to this project and shows no project picker. */
  fixedProjectId?: string
  onNewProject?(): void
  onSubmit(projectId: string, request: { title: string; description: string }): void
}

export function Composer({ projects, fixedProjectId, onNewProject, onSubmit }: Props) {
  const [text, setText] = useState('')
  const [chosen, setChosen] = useState('')

  const projectId =
    fixedProjectId ??
    (projects.some((project) => project.id === chosen) ? chosen : projects.at(-1)?.id)
  const request = parseRequest(text)
  const ready = Boolean(request && projectId)

  const submit = () => {
    if (!request || !projectId) return
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
          autoFocus={!fixedProjectId}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="composer-actions">
          <span className="hint">Enter to create, Shift+Enter for a new line</span>
          <button type="submit" className="send" aria-label="Create work item" disabled={!ready}>
            <ArrowUp size={20} />
          </button>
        </div>
      </div>
      {!fixedProjectId && (
        <div className="composer-bar">
          {projects.length > 0 && (
            <label className="picker">
              <Compass size={16} />
              <select
                aria-label="Project"
                value={projectId}
                onChange={(event) => setChosen(event.target.value)}
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={14} />
            </label>
          )}
          <button type="button" className="bar-button" onClick={onNewProject}>
            <Plus size={16} />
            {projects.length === 0 ? 'Create a project first' : 'New project'}
          </button>
        </div>
      )}
    </form>
  )
}
