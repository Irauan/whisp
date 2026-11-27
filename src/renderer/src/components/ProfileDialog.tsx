import { useState } from 'react'
import { useGithubAccounts } from '../../../features/profiles/list-github-accounts/list-github-accounts.ui'
import type { ProfileView } from '../useProfiles'
import { Modal } from './Dialogs'

/** What the dialog saves. A blank optional field is null. The main process checks each value. */
export interface ProfileValues {
  name: string
  workspaceDirectory: string
  github: { login: string; name: string | null; avatar: string | null } | null
  claudeFolder: string | null
  claudeProfileName: string | null
}

interface Props {
  /** Without a profile, the dialog adds a new one. With one, it shows its settings. */
  profile?: ProfileView
  onClose(): void
  /** Resolves to the text of an error, or to null after a save. The caller closes the dialog. */
  onSave(values: ProfileValues): Promise<string | null>
}

const orNull = (text: string) => (text.trim() === '' ? null : text.trim())

export function ProfileDialog({ profile, onClose, onSave }: Props) {
  const [name, setName] = useState(profile?.name ?? '')
  const [workspaceDirectory, setWorkspaceDirectory] = useState(profile?.workspaceDirectory ?? '')
  const [login, setLogin] = useState(profile?.github?.login ?? '')
  const [claudeFolder, setClaudeFolder] = useState(profile?.claudeFolder ?? '')
  const [claudeProfileName, setClaudeProfileName] = useState(profile?.claudeProfileName ?? '')
  const [problem, setProblem] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { found, readAgain } = useGithubAccounts()

  const profiles = found?.ok ? [...found.profiles] : []
  // Keep the saved GitHub account, also when the GitHub CLI does not list it.
  const saved = profile?.github
  if (saved && !profiles.some((profile) => profile.login === saved.login)) profiles.unshift(saved)

  const github = profiles.find((profile) => profile.login === login) ?? null
  // During a new read, a chosen GitHub account can be missing for a moment.
  const ready = name.trim() !== '' && workspaceDirectory.trim() !== '' && (!login || github !== null) && !saving
  const title = profile ? 'Profile settings' : 'Add profile'

  const browse = async (apply: (path: string) => void) => {
    try {
      const path = await window.aether.chooseFolder()
      if (path) apply(path)
    } catch (cause) {
      setProblem(`Aether could not open the folder picker. ${String(cause)}`)
    }
  }

  const save = async () => {
    if (!ready) return
    setSaving(true)
    setProblem(null)
    const message = await onSave({
      name: name.trim(),
      workspaceDirectory: workspaceDirectory.trim(),
      github: github && {
        login: github.login,
        name: github.name,
        // The main process accepts only a picture as a data URL.
        avatar: github.avatar?.startsWith('data:image/') ? github.avatar : null
      },
      claudeFolder: orNull(claudeFolder),
      claudeProfileName: orNull(claudeProfileName)
    })
    setSaving(false)
    if (message) setProblem(message)
  }

  return (
    <Modal label={title} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <h2>{title}</h2>
        <label className="field">
          Name
          <input
            value={name}
            maxLength={40}
            placeholder="Work"
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="field">
          <label>
            Workspace directory
            <input value={workspaceDirectory} placeholder="The folder that holds your repositories" onChange={(event) => setWorkspaceDirectory(event.target.value)} />
          </label>
          <button type="button" className="button" aria-label="Browse for the workspace directory" onClick={() => void browse(setWorkspaceDirectory)}>
            Browse
          </button>
        </div>
        <fieldset className="field">
          <legend>GitHub account</legend>
          <label className="choice">
            <input type="radio" name="github" checked={!login} onChange={() => setLogin('')} />
            <span className="row-label">None</span>
          </label>
          {profiles.map((profile) => (
            <label key={profile.login} className="choice">
              <input
                type="radio"
                name="github"
                checked={login === profile.login}
                onChange={() => setLogin(profile.login)}
              />
              {profile.avatar && (
                <img className="avatar" src={profile.avatar} width={24} height={24} alt="" />
              )}
              <span className="row-label">{profile.name ?? profile.login}</span>
              <span className="row-note">@{profile.login}</span>
            </label>
          ))}
          <p className="muted" role="status">
            {!found && 'Reading your GitHub accounts…'}
            {found && !found.ok && found.reason}
          </p>
        </fieldset>
        {found && (
          <p className="hint">
            To use another GitHub account, run <code>gh auth login</code> in a terminal.{' '}
            <button type="button" className="link" onClick={readAgain}>
              Read again
            </button>
          </p>
        )}
        <fieldset className="field">
          <legend>Claude Code provider</legend>
          <label className="field">
            Claude folder
            <input
              value={claudeFolder}
              placeholder="The Claude configuration folder"
              onChange={(event) => setClaudeFolder(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="button"
            aria-label="Browse for the Claude folder"
            onClick={() => void browse(setClaudeFolder)}
          >
            Browse
          </button>
          <label className="field">
            Claude profile name
            <input
              value={claudeProfileName}
              maxLength={100}
              placeholder="The profile name"
              onChange={(event) => setClaudeProfileName(event.target.value)}
            />
          </label>
          <p className="muted">Aether stores no key and no token. Sign in to Claude in this folder.</p>
        </fieldset>
        {problem && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={!ready}>
            {profile ? 'Save' : 'Add profile'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
