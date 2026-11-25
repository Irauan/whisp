import {
  Blocks,
  Bot,
  ChevronRight,
  CircleDot,
  Compass,
  GitPullRequest,
  MessageSquare,
  Plus,
  type LucideIcon
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { STAGES, type AccountContent } from '../../../shared/model'
import type { View } from '../navigation'

interface Props {
  content: AccountContent
  view: View
  onGo(view: View): void
  onNewProject(): void
}

function NavRow(props: {
  icon: ReactNode
  label: string
  active: boolean
  soon?: boolean
  onClick(): void
}) {
  return (
    <button
      type="button"
      className="row"
      aria-current={props.active ? 'page' : undefined}
      onClick={props.onClick}
    >
      {props.icon}
      <span className="row-label">{props.label}</span>
      {props.soon && <span className="tag">Coming soon</span>}
    </button>
  )
}

const PAGES: { view: View; label: string; icon: LucideIcon; soon?: boolean }[] = [
  { view: { kind: 'home' }, label: 'New', icon: Plus },
  { view: { kind: 'pulls' }, label: 'Pull requests', icon: GitPullRequest, soon: true },
  { view: { kind: 'items' }, label: 'Work items', icon: CircleDot, soon: true },
  { view: { kind: 'bots' }, label: 'Bots', icon: Bot, soon: true },
  { view: { kind: 'customize' }, label: 'Customize', icon: Blocks, soon: true }
]

export function Sidebar({ content, view, onGo, onNewProject }: Props) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  const toggle = (projectId: string) =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (!next.delete(projectId)) next.add(projectId)
      return next
    })

  return (
    <nav className="sidebar-body" aria-label="Main">
      <div className="group">
        {PAGES.map((page) => (
          <NavRow
            key={page.view.kind}
            icon={<page.icon size={18} />}
            label={page.label}
            active={view.kind === page.view.kind}
            soon={page.soon}
            onClick={() => onGo(page.view)}
          />
        ))}
      </div>

      <div className="group-head">
        <h2>Projects</h2>
        <button type="button" className="icon-button" aria-label="New project" onClick={onNewProject}>
          <Plus size={18} />
        </button>
      </div>
      <div className="group">
        {content.projects.length === 0 && <p className="empty-row">No projects yet</p>}
        {content.projects.map((project) => {
          const items = content.workItems.filter((item) => item.projectId === project.id)
          const open = !collapsed.has(project.id)
          return (
            <div key={project.id}>
              <div className="project-row">
                <NavRow
                  icon={<Compass size={18} className="project-icon" />}
                  label={project.name}
                  active={view.kind === 'project' && view.projectId === project.id}
                  onClick={() => onGo({ kind: 'project', projectId: project.id })}
                />
                {items.length > 0 && (
                  <button
                    type="button"
                    className="icon-button twist"
                    aria-label={`${open ? 'Hide' : 'Show'} work items of ${project.name}`}
                    aria-expanded={open}
                    onClick={() => toggle(project.id)}
                  >
                    <ChevronRight size={16} />
                  </button>
                )}
              </div>
              {open &&
                items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="row child"
                    aria-current={
                      view.kind === 'item' && view.itemId === item.id ? 'page' : undefined
                    }
                    onClick={() => onGo({ kind: 'item', itemId: item.id })}
                  >
                    <span className={`dot stage-${item.stage}`} aria-hidden="true" />
                    <span className="row-label">{item.title}</span>
                    <span className="row-note">
                      {STAGES.find((stage) => stage.id === item.stage)?.label}
                    </span>
                  </button>
                ))}
            </div>
          )
        })}
      </div>

      <div className="group-head">
        <h2>Sessions</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="New session"
          onClick={() => onGo({ kind: 'home' })}
        >
          <Plus size={18} />
        </button>
      </div>
      <div className="group">
        {content.sessions.length === 0 && <p className="empty-row">No sessions yet</p>}
        {content.sessions.toReversed().map((session) => (
          <NavRow
            key={session.id}
            icon={<MessageSquare size={18} />}
            label={session.title}
            active={view.kind === 'session' && view.sessionId === session.id}
            onClick={() => onGo({ kind: 'session', sessionId: session.id })}
          />
        ))}
      </div>
    </nav>
  )
}
