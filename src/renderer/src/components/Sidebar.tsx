import {
  Blocks,
  Bot,
  CircleDot,
  Compass,
  GitPullRequest,
  MessageSquare,
  Plus,
  type LucideIcon
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { View } from '../navigation'
import type { SessionDraft } from '../useWorkspaces'

interface Props {
  sessions: SessionDraft[]
  view: View
  onGo(view: View): void
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
  { view: { kind: 'projects' }, label: 'Projects', icon: Compass, soon: true },
  { view: { kind: 'items' }, label: 'Work items', icon: CircleDot, soon: true },
  { view: { kind: 'bots' }, label: 'Bots', icon: Bot, soon: true },
  { view: { kind: 'customize' }, label: 'Customize', icon: Blocks, soon: true }
]

export function Sidebar({ sessions, view, onGo }: Props) {
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
        {sessions.length === 0 && <p className="empty-row">No sessions yet</p>}
        {sessions.toReversed().map((session) => (
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
