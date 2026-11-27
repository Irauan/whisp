import { useState } from 'react'
import type { ProfileView } from '../useProfiles'
import { Modal } from './Dialogs'

interface Props {
  /** The profiles that have no workspace directory yet. */
  profiles: ProfileView[]
  onClose(): void
  /** Resolves to the text of an error, or to null after a save. */
  onSave(directories: { profileId: string; workspaceDirectory: string }[]): Promise<string | null>
}

/** Flow 1 of m1-chat: after the import, the user chooses the workspace directory of each profile. */
export function DirectoriesDialog({ profiles, onClose, onSave }: Props) {
  const [directories, setDirectories] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const directoryOf = (id: string) => directories[id] ?? ''
  const ready = !saving && profiles.every((profile) => directoryOf(profile.id).trim() !== '')

  const browse = async (id: string) => {
    try {
      const path = await window.aether.chooseFolder()
      if (path) setDirectories((current) => ({ ...current, [id]: path }))
    } catch (cause) {
      setProblem(`Aether could not open the folder picker. ${String(cause)}`)
    }
  }

  const save = async () => {
    if (!ready) return
    setSaving(true)
    setProblem(null)
    const message = await onSave(profiles.map(({ id }) => ({ profileId: id, workspaceDirectory: directoryOf(id).trim() })))
    setSaving(false)
    if (message) setProblem(message)
  }

  return (
    <Modal label="Choose workspace directories" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <h2>Choose workspace directories</h2>
        <p className="muted">
          Aether made a profile of each account. Choose the folder that holds the repositories of each profile.
        </p>
        {profiles.map((profile) => (
          <div key={profile.id} className="field">
            <label>
              Workspace directory of {profile.name}
              <input
                value={directoryOf(profile.id)}
                placeholder="The folder that holds your repositories"
                autoFocus={profile === profiles[0]}
                onChange={(event) => setDirectories((current) => ({ ...current, [profile.id]: event.target.value }))}
              />
            </label>
            <button
              type="button"
              className="button"
              aria-label={`Browse for the workspace directory of ${profile.name}`}
              onClick={() => void browse(profile.id)}
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
            Save directories
          </button>
        </div>
      </form>
    </Modal>
  )
}
