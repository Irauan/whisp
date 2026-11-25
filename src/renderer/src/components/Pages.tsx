import { Check, FolderOpen, GitPullRequest, Hand, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { STAGES, type Project, type StageId, type WorkItem } from '../../../shared/model'
import type { View } from '../navigation'
import { AgentPanel } from './AgentPanel'
import { Composer } from './Composer'
import { Mark } from './Mark'

type Request = { title: string; description: string }

export function HomePage(props: {
  projects: Project[]
  onNewProject(): void
  onAddItem(projectId: string, request: Request): void
}) {
  return (
    <div className="home">
      <Mark size={84} />
      <Composer
        projects={props.projects}
        onNewProject={props.onNewProject}
        onSubmit={props.onAddItem}
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

export function InboxPage() {
  return (
    <EmptyPage
      icon={<Hand size={36} />}
      title="No raised hands"
      body="Questions from your agents will appear here. For now, each work item shows its own."
    />
  )
}

export function PullRequestsPage() {
  return (
    <EmptyPage
      icon={<GitPullRequest size={36} />}
      title="No pull requests"
      body="Pull requests of your work items will appear here. GitHub is not connected yet."
    />
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
        projects={[project]}
        fixedProjectId={project.id}
        onSubmit={props.onAddItem}
      />
      <div className="board">
        {STAGES.map((stage) => {
          const inStage = items.filter((item) => item.stage === stage.id)
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
                  {item.title}
                </button>
              ))}
            </section>
          )
        })}
      </div>
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
        <p className="muted">Nothing linked. GitHub is not connected yet.</p>
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
