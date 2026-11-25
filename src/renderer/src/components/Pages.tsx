import {
  Blocks,
  Bot,
  Check,
  CircleDot,
  FolderOpen,
  GitPullRequest,
  Pencil,
  Plus,
  Trash2
} from 'lucide-react'
import type { ReactNode } from 'react'
import {
  contentOf,
  STAGES,
  type AccountContent,
  type Project,
  type Session,
  type SessionSettings,
  type StageId,
  type WorkItem,
  type Workspace
} from '../../../shared/model'
import type { View } from '../navigation'
import { AgentPanel } from './AgentPanel'
import { Avatar, githubNote } from './Avatar'
import { Composer } from './Composer'
import { Mark } from './Mark'
import { SessionComposer } from './SessionComposer'

type Request = { title: string; description: string }

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

function Board(props: { items: WorkItem[]; projects?: Project[]; onGo(view: View): void }) {
  return (
    <div className="board">
      {STAGES.map((stage) => {
        const inStage = props.items.filter((item) => item.stage === stage.id)
        return (
          <section key={stage.id} className="column" aria-label={stage.label}>
            <h2>
              <span className={`dot stage-${stage.id}`} aria-hidden="true" />
              {stage.label}
              <span className="count">{inStage.length}</span>
            </h2>
            {inStage.map((item) => (
              <button
                key={item.id}
                type="button"
                className="card"
                onClick={() => props.onGo({ kind: 'item', itemId: item.id })}
              >
                {props.projects && (
                  <span className="card-note">
                    {props.projects.find((project) => project.id === item.projectId)?.name}
                  </span>
                )}
                {item.title}
              </button>
            ))}
          </section>
        )
      })}
    </div>
  )
}

export function WorkItemsPage(props: { content: AccountContent; onGo(view: View): void }) {
  const { projects, workItems } = props.content
  if (workItems.length === 0) {
    return (
      <EmptyPage
        icon={<CircleDot size={36} />}
        title="No work items"
        body="Work items of all your projects will appear here. Open a project to create one."
      />
    )
  }
  return (
    <div className="page wide">
      <header className="page-head">
        <h1>Work items</h1>
      </header>
      <Board items={workItems} projects={projects} onGo={props.onGo} />
    </div>
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
        Each account has its own projects, work items and sessions. The GitHub sign-in stays in the GitHub CLI.
      </p>
      {accounts.map((account) => {
        const { projects, workItems, sessions } = contentOf(props.workspace, account.id)
        return (
          <section key={account.id} className="panel account-panel" aria-label={account.label}>
            <Avatar account={account} size={40} />
            <div className="account-text">
              <h2>{account.label}</h2>
              <p className="muted">
                {githubNote(account)} · Projects: {projects.length} · Work items: {workItems.length}{' '}
                · Sessions: {sessions.length}
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

export function ProjectPage(props: {
  project: Project
  items: WorkItem[]
  onAddItem(projectId: string, request: Request): void
  onGo(view: View): void
  onChooseFolder(): void
  onDelete(): void
}) {
  const { project, items } = props
  return (
    <div className="page wide">
      <header className="page-head">
        <h1>{project.name}</h1>
        <button type="button" className="icon-button" aria-label="Delete project" onClick={props.onDelete}>
          <Trash2 size={18} />
        </button>
      </header>
      <p className="folder">
        <FolderOpen size={16} />
        <span className={project.path ? 'folder-path' : 'folder-path muted'}>
          {project.path ?? 'No folder. Agents need one to work on this project.'}
        </span>
        <button type="button" className="bar-button" onClick={props.onChooseFolder}>
          {project.path ? 'Change' : 'Choose folder'}
        </button>
      </p>
      <Composer
        key={project.id}
        projectId={project.id}
        onSubmit={props.onAddItem}
      />
      <Board items={items} onGo={props.onGo} />
    </div>
  )
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function ItemPage(props: {
  item: WorkItem
  project: Project
  onMove(stage: StageId): void
  onGo(view: View): void
  onChooseFolder(): void
  onDelete(): void
}) {
  const { item, project } = props
  const position = STAGES.findIndex((stage) => stage.id === item.stage)
  // A skipped stage gets no check mark.
  const passed = (stage: StageId, index: number) =>
    index < position && item.history.some((change) => change.stage === stage)
  return (
    <div className="page">
      <button
        type="button"
        className="crumb"
        onClick={() => props.onGo({ kind: 'project', projectId: project.id })}
      >
        {project.name}
      </button>
      <header className="page-head">
        <h1>{item.title}</h1>
        <button type="button" className="icon-button" aria-label="Delete work item" onClick={props.onDelete}>
          <Trash2 size={18} />
        </button>
      </header>
      {item.description && <p className="description">{item.description}</p>}

      <ol className="stages" aria-label="Stage">
        {STAGES.map((stage, index) => (
          <li key={stage.id}>
            <button
              type="button"
              className={passed(stage.id, index) ? 'stage passed' : 'stage'}
              aria-current={index === position ? 'step' : undefined}
              onClick={() => props.onMove(stage.id)}
            >
              {passed(stage.id, index) && <Check size={14} />}
              {stage.label}
            </button>
          </li>
        ))}
      </ol>

      <AgentPanel key={item.id} item={item} project={project} onChooseFolder={props.onChooseFolder} />
      <section className="panel">
        <h2>Pull request and Actions</h2>
        <p className="muted">Nothing linked. Aether cannot read pull requests yet.</p>
      </section>
      <section className="panel">
        <h2>History</h2>
        <ul className="history">
          {item.history.toReversed().map((change) => (
            <li key={change.at + change.stage}>
              <span className={`dot stage-${change.stage}`} aria-hidden="true" />
              {STAGES.find((stage) => stage.id === change.stage)?.label}
              <time dateTime={change.at}>{dateFormat.format(new Date(change.at))}</time>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
