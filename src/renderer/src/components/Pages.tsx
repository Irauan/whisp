import { Blocks, Bot, CircleDot, Compass, GitPullRequest, Pencil, Plus, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { SessionSettings } from '../../../shared/model'
import type { Mode, SessionView, ProfileView } from '../useProfiles'
import { Avatar, githubNote } from './Avatar'
import { Mark } from './Mark'
import { SessionComposer } from './SessionComposer'

export function HomePage(props: {
  sessions: SessionView[]
  newSessionMode: Mode
  githubLogin: string | null
  /** Creates the session. It returns the text of an error, or null after a success. */
  onStart(prompt: string, settings: SessionSettings): Promise<string | null>
}) {
  return (
    <div className="home">
      <Mark size={150} />
      <SessionComposer
        sessions={props.sessions}
        newSessionMode={props.newSessionMode}
        githubLogin={props.githubLogin}
        onSubmit={props.onStart}
      />
    </div>
  )
}

export function EmptyPage(props: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty-page">
      {props.icon}
      <h1>{props.title}</h1>
      <p className="muted">{props.body}</p>
      {props.action}
    </div>
  )
}

export function PullRequestsPage() {
  return (
    <EmptyPage
      icon={<GitPullRequest size={36} />}
      title="No pull requests"
      body="Pull requests will appear here. Aether cannot read pull requests yet."
    />
  )
}

export function BotsPage() {
  return (
    <EmptyPage
      icon={<Bot size={36} />}
      title="No bots"
      body="Bots will run repeated work for you. Aether cannot run bots yet."
    />
  )
}

export function CustomizePage() {
  return (
    <EmptyPage
      icon={<Blocks size={36} />}
      title="Nothing installed"
      body="You will add skills, MCP servers and plugins here. Aether cannot install them yet."
    />
  )
}

export function ProjectsPage() {
  return (
    <EmptyPage
      icon={<Compass size={36} />}
      title="Coming soon"
      body="Projects will group your work. Aether cannot show projects yet."
    />
  )
}

export function WorkItemsPage() {
  return (
    <EmptyPage
      icon={<CircleDot size={36} />}
      title="Coming soon"
      body="Work items will track your tasks. Aether cannot show work items yet."
    />
  )
}

export function ProfilesPage(props: {
  profiles: ProfileView[]
  currentId: string | null
  onAdd(): void
  onSwitch(profileId: string): void
  onEdit(profileId: string): void
  onDelete(profileId: string): void
}) {
  const { profiles, currentId } = props
  return (
    <div className="page">
      <header className="page-head">
        <h1>Profiles</h1>
        <button type="button" className="button with-icon" onClick={props.onAdd}>
          <Plus size={16} />
          Add profile
        </button>
      </header>
      <p className="muted description">
        Each profile has its own workspace directory and its own sessions. The GitHub sign-in stays in the GitHub CLI.
      </p>
      {profiles.length === 0 && <p className="empty-row">No profiles yet</p>}
      {profiles.map((profile) => (
        <section key={profile.id} className="panel account-panel" aria-label={profile.name}>
          <Avatar profile={profile} size={40} />
          <div className="account-text">
            <h2>{profile.name}</h2>
            <p className="muted">
              {githubNote(profile)} · {profile.workspaceDirectory ?? 'No workspace directory yet'}
            </p>
          </div>
          {profile.id === currentId ? (
            <span className="muted">In use</span>
          ) : (
            <button type="button" className="button" onClick={() => props.onSwitch(profile.id)}>
              Switch
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label={`Edit ${profile.name}`}
            onClick={() => props.onEdit(profile.id)}
          >
            <Pencil size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={`Remove ${profile.name}`}
            onClick={() => props.onDelete(profile.id)}
          >
            <Trash2 size={18} />
          </button>
        </section>
      ))}
    </div>
  )
}
