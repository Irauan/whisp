import { Blocks, Bot, CircleDot, Compass, GitPullRequest, Pencil, Plus, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  contentOf,
  type Session,
  type SessionSettings,
  type Workspace
} from '../../../shared/model'
import { Avatar, githubNote } from './Avatar'
import { Mark } from './Mark'
import { SessionComposer } from './SessionComposer'

export function HomePage(props: {
  sessions: Session[]
  githubLogin: string | null
  onStart(prompt: string, settings: SessionSettings): void
}) {
  return (
    <div className="home">
      <Mark size={150} />
      <SessionComposer
        sessions={props.sessions}
        githubLogin={props.githubLogin}
        onSubmit={props.onStart}
      />
    </div>
  )
}

export function EmptyPage(props: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="empty-page">
      {props.icon}
      <h1>{props.title}</h1>
      <p className="muted">{props.body}</p>
    </div>
  )
}

export function PullRequestsPage() {
  return (
    <EmptyPage
      icon={<GitPullRequest size={36} />}
      title="No pull requests"
      body="Pull requests of your work items will appear here. Aether cannot read pull requests yet."
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

export function AccountsPage(props: {
  workspace: Workspace
  onAdd(): void
  onSwitch(accountId: string): void
  onEdit(accountId: string): void
  onDelete(accountId: string): void
}) {
  const { accounts, currentAccountId } = props.workspace
  return (
    <div className="page">
      <header className="page-head">
        <h1>Accounts</h1>
        <button type="button" className="button with-icon" onClick={props.onAdd}>
          <Plus size={16} />
          Add account
        </button>
      </header>
      <p className="muted description">
        Each account has its own sessions. The GitHub sign-in stays in the GitHub CLI.
      </p>
      {accounts.map((account) => {
        const { sessions } = contentOf(props.workspace, account.id)
        return (
          <section key={account.id} className="panel account-panel" aria-label={account.label}>
            <Avatar account={account} size={40} />
            <div className="account-text">
              <h2>{account.label}</h2>
              <p className="muted">
                {githubNote(account)} · Sessions: {sessions.length}
              </p>
            </div>
            {account.id === currentAccountId ? (
              <span className="muted">In use</span>
            ) : (
              <button type="button" className="button" onClick={() => props.onSwitch(account.id)}>
                Switch
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label={`Edit ${account.label}`}
              onClick={() => props.onEdit(account.id)}
            >
              <Pencil size={18} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label={`Remove ${account.label}`}
              title={accounts.length === 1 ? 'You cannot remove the last account' : undefined}
              disabled={accounts.length === 1}
              onClick={() => props.onDelete(account.id)}
            >
              <Trash2 size={18} />
            </button>
          </section>
        )
      })}
    </div>
  )
}
