import { useState } from 'react'
import { useGithubAccounts } from '../../../features/workspaces/list-github-accounts/list-github-accounts.ui'
import type { Account, GithubProfile } from '../../../shared/model'
import { Modal } from './Dialogs'

interface Props {
  /** Without an account, the dialog adds a new one. */
  account?: Account
  onClose(): void
  onSave(label: string, github: GithubProfile | null): void
}

export function AccountDialog({ account, onClose, onSave }: Props) {
  const [label, setLabel] = useState(account?.label ?? '')
  const [login, setLogin] = useState(account?.github?.login ?? '')
  const { found, readAgain } = useGithubAccounts()

  const profiles = found?.ok ? [...found.profiles] : []
  // Keep the saved GitHub account, also when the GitHub CLI does not list it.
  const saved = account?.github
  if (saved && !profiles.some((profile) => profile.login === saved.login)) profiles.unshift(saved)

  const trimmed = label.trim()
  const github = profiles.find((profile) => profile.login === login) ?? null
  // During a new read, a chosen GitHub account can be missing for a moment.
  const ready = Boolean(trimmed) && (!login || github !== null)
  const title = account ? 'Edit account' : 'Add account'

  return (
    <Modal label={title} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (ready) onSave(trimmed, github)
        }}
      >
        <h2>{title}</h2>
        <label className="field">
          Name
          <input
            value={label}
            maxLength={40}
            placeholder="Work"
            autoFocus
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
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
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={!ready}>
            {account ? 'Save' : 'Add account'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
