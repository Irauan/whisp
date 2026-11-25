import { ChevronRight, Compass, GitPullRequest, Hand, House, Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { STAGES, type Workspace } from '../../../shared/model'
import type { View } from '../navigation'

interface Props {
  workspace: Workspace
  view: View
  onGo(view: View): void
  onNewProject(): void
}

function NavRow(props: { icon: ReactNode; label: string; active: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      className="row"
      aria-current={props.active ? 'page' : undefined}
      onClick={props.onClick}
    >
      {props.icon}
      <span className="row-label">{props.label}</span>
    </button>
  )
}

export function Sidebar({ workspace, view, onGo, onNewProject }: Props) {
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
        <NavRow
          icon={<House size={18} />}
          label="Home"
          active={view.kind === 'home'}
          onClick={() => onGo({ kind: 'home' })}
        />
        <NavRow
          icon={<Hand size={18} />}
          label="Inbox"
          active={view.kind === 'inbox'}
          onClick={() => onGo({ kind: 'inbox' })}
        />
        <NavRow
          icon={<GitPullRequest size={18} />}
          label="Pull requests"
          active={view.kind === 'pulls'}
          onClick={() => onGo({ kind: 'pulls' })}
        />
      </div>

      <div className="group-head">
        <h2>Projects</h2>
        <button type="button" className="icon-button" aria-label="New project" onClick={onNewProject}>
          <Plus size={18} />
        </button>
      </div>
      <div className="group">
        {workspace.projects.length === 0 && <p className="empty-row">No projects yet</p>}
        {workspace.projects.map((project) => {
          const items = workspace.workItems.filter((item) => item.projectId === project.id)
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
      </div>
      <p className="empty-row">No sessions yet</p>
    </nav>
  )
}
