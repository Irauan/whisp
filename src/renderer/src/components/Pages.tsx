import { Blocks, Bot, CircleDot, Compass, GitPullRequest, Pencil, Plus, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { SessionSettings } from '../../../shared/model'
import type { SessionDraft, WorkspaceView } from '../useWorkspaces'
import { Avatar, githubNote } from './Avatar'
import { Mark } from './Mark'
import { SessionComposer } from './SessionComposer'

export function HomePage(props: {
  sessions: SessionDraft[]
  githubLogin: string | null
  /** Why a new session cannot start, or null. The composer shows it and disables Send. */
  unavailable: string | null
  onStart(prompt: string, settings: SessionSettings): void
}) {
  return (
    <div className="home">
      <Mark size={150} />
      <SessionComposer
        sessions={props.sessions}
        githubLogin={props.githubLogin}
        unavailable={props.unavailable}
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

export function WorkspacesPage(props: {
  workspaces: WorkspaceView[]
  currentId: string | null
  onAdd(): void
  onSwitch(workspaceId: string): void
  onEdit(workspaceId: string): void
  onDelete(workspaceId: string): void
}) {
  const { workspaces, currentId } = props
  return (
    <div className="page">
      <header className="page-head">
        <h1>Workspaces</h1>
        <button type="button" className="button with-icon" onClick={props.onAdd}>
          <Plus size={16} />
          Add workspace
        </button>
      </header>
      <p className="muted description">
        Each workspace has its own root and its own sessions. The GitHub sign-in stays in the GitHub CLI.
      </p>
      {workspaces.length === 0 && <p className="empty-row">No workspaces yet</p>}
      {workspaces.map((workspace) => (
        <section key={workspace.id} className="panel account-panel" aria-label={workspace.name}>
          <Avatar workspace={workspace} size={40} />
          <div className="account-text">
            <h2>{workspace.name}</h2>
            <p className="muted">
              {githubNote(workspace)} · {workspace.root ?? 'No root yet'}
            </p>
          </div>
          {workspace.id === currentId ? (
            <span className="muted">In use</span>
          ) : (
            <button type="button" className="button" onClick={() => props.onSwitch(workspace.id)}>
              Switch
            </button>
          )}
          <button
            type="button"
            className="icon-button"
            aria-label={`Edit ${workspace.name}`}
            onClick={() => props.onEdit(workspace.id)}
          >
            <Pencil size={18} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={`Remove ${workspace.name}`}
            onClick={() => props.onDelete(workspace.id)}
          >
            <Trash2 size={18} />
          </button>
        </section>
      ))}
    </div>
  )
}
