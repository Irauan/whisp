import { useState } from 'react'
import type { WorkspaceView } from '../useWorkspaces'
import { Modal } from './Dialogs'

interface Props {
  /** The workspaces that have no root yet. */
  workspaces: WorkspaceView[]
  onClose(): void
  /** Resolves to the text of an error, or to null after a save. */
  onSave(roots: { workspaceId: string; root: string }[]): Promise<string | null>
}

/** Flow 1 of m1-chat: after the import, the user chooses the root of each workspace. */
export function RootsDialog({ workspaces, onClose, onSave }: Props) {
  const [roots, setRoots] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const rootOf = (id: string) => roots[id] ?? ''
  const ready = !saving && workspaces.every((workspace) => rootOf(workspace.id).trim() !== '')

  const browse = async (id: string) => {
    try {
      const path = await window.aether.chooseFolder()
      if (path) setRoots((current) => ({ ...current, [id]: path }))
    } catch (cause) {
      setProblem(`Aether could not open the folder picker. ${String(cause)}`)
    }
  }

  const save = async () => {
    if (!ready) return
    setSaving(true)
    setProblem(null)
    const message = await onSave(workspaces.map(({ id }) => ({ workspaceId: id, root: rootOf(id).trim() })))
    setSaving(false)
    if (message) setProblem(message)
  }

  return (
    <Modal label="Choose workspace roots" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <h2>Choose workspace roots</h2>
        <p className="muted">
          Aether made a workspace of each account. Choose the folder that holds the repositories of each workspace.
        </p>
        {workspaces.map((workspace) => (
          <div key={workspace.id} className="field">
            <label>
              Root of {workspace.name}
              <input
                value={rootOf(workspace.id)}
                placeholder="The folder that holds your repositories"
                autoFocus={workspace === workspaces[0]}
                onChange={(event) => setRoots((current) => ({ ...current, [workspace.id]: event.target.value }))}
              />
            </label>
            <button
              type="button"
              className="button"
              aria-label={`Browse for the root of ${workspace.name}`}
              onClick={() => void browse(workspace.id)}
            >
              Browse
            </button>
          </div>
        ))}
        {problem && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
        <div className="dialog-actions">
          <button type="submit" className="button primary" disabled={!ready}>
            Save roots
          </button>
        </div>
      </form>
    </Modal>
  )
}
