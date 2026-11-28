import {
  Blocks,
  Bot,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Compass,
  Folder,
  GitPullRequest,
  Hand,
  Link,
  MessageSquare,
  Plus,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import { Fragment, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { baseName } from '../../../shared/model'
import type { View } from '../navigation'
import { groupState, sessionState, type SessionState } from '../sidebar-state'
import type { FolderView, SessionView } from '../useProfiles'
import { GithubMark } from './GithubMark'
import { MenuOption } from './Menu'

interface Props {
  /** The sessions of the profile, oldest first, with their live state. */
  sessions: SessionView[]
  /** The folders of the profile, the newest activity first. Each is a group. */
  folders: FolderView[]
  /** The sessions that wait for the trust or the directory question: they need the user (open choice 5, A). */
  askingIds: ReadonlySet<string>
  view: View
  onGo(view: View): void
  onToggleFolder(folderId: string, collapsed: boolean): void
  /** Opens the folder picker and adds the folder that the user chooses. */
  onAddFolder(): void
  onRemoveFolder(folderId: string): void
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

const SESSIONS_MENU = 'sidebar-sessions-menu'
const FOLDER_MENU = 'sidebar-folder-menu'

/** The icon of a session row: the raised hand for a question, else the chat icon. The class sets its color and motion. */
function StateIcon({ state }: { state: SessionState | null }) {
  if (state === 'Needs your answer') return <Hand size={18} className="state-attention" aria-hidden />
  const className = state === 'Working' ? 'state-working' : state === 'New answer' ? 'state-unread' : undefined
  return <MessageSquare size={18} className={className} aria-hidden />
}

/**
 * One session of a group. The accessible name stays the title. The state is the accessible description:
 * its element sits next to the button, because text inside the button would join the name.
 */
function SessionRow(props: { session: SessionView; state: SessionState | null; active: boolean; onClick(): void }) {
  const describedBy = `state-${props.session.id}`
  return (
    <>
      <button
        type="button"
        className="row child"
        aria-current={props.active ? 'page' : undefined}
        aria-describedby={props.state ? describedBy : undefined}
        onClick={props.onClick}
      >
        <StateIcon state={props.state} />
        <span className="row-label">{props.session.title}</span>
      </button>
      {props.state && (
        <span id={describedBy} hidden>
          {props.state}
        </span>
      )}
    </>
  )
}

/** The place and the folder of an open folder menu. */
interface FolderMenuTarget {
  folder: FolderView
  /** True when no session uses the folder. Only such a folder can go. */
  empty: boolean
  x: number
  y: number
}

export function Sidebar({ sessions, folders, askingIds, view, onGo, onToggleFolder, onAddFolder, onRemoveFolder }: Props) {
  const [menuTarget, setMenuTarget] = useState<FolderMenuTarget | null>(null)
  const folderMenu = useRef<HTMLDivElement>(null)

  // The menu opens when it has a target, and closes by itself on Escape, a click outside or a choice.
  useEffect(() => {
    const menu = folderMenu.current
    if (!menu || !menuTarget || menu.matches(':popover-open')) return
    menu.showPopover()
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [menuTarget])

  const stateOf = (session: SessionView) =>
    sessionState({ status: session.status, openCardIds: session.openCardIds, unread: session.unread, asking: askingIds.has(session.id) })
  const newFirst = sessions.toReversed()

  const onContextMenu = (folder: FolderView, empty: boolean) => (event: MouseEvent<HTMLElement>) => {
    event.preventDefault()
    // A key (the menu key, Shift+F10) gives no pointer: the menu opens at the toggle.
    const box = event.currentTarget.getBoundingClientRect()
    const fromKey = event.clientX === 0 && event.clientY === 0
    const x = fromKey ? box.left + 28 : event.clientX
    const y = fromKey ? box.bottom : event.clientY
    // The menu is 190 px wide and about 90 px high: keep it inside the window.
    setMenuTarget({ folder, empty, x: Math.max(0, Math.min(x, window.innerWidth - 200)), y: Math.max(0, Math.min(y, window.innerHeight - 100)) })
  }

  const newSessionIn = (folder: FolderView) => onGo({ kind: 'home', folder: folder.path })

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
        <button type="button" className="icon-button" aria-label="Start a session or add a folder" popoverTarget={SESSIONS_MENU}>
          <Plus size={18} />
        </button>
      </div>
      <div id={SESSIONS_MENU} className="popover sessions-menu" popover="auto" role="group" aria-label="Start a session or add a folder">
        <p className="popover-title">Start session in</p>
        {folders.map((folder) => (
          <MenuOption key={folder.id} menu={SESSIONS_MENU} title={baseName(folder.path)} icon={<Folder size={16} />} onSelect={() => newSessionIn(folder)} />
        ))}
        {folders.length > 0 && <hr />}
        <MenuOption menu={SESSIONS_MENU} title="Add from GitHub" icon={<GithubMark size={16} />} tag="Coming soon" disabled onSelect={() => undefined} />
        <MenuOption menu={SESSIONS_MENU} title="Add from URL" icon={<Link size={16} />} tag="Coming soon" disabled onSelect={() => undefined} />
        <MenuOption menu={SESSIONS_MENU} title="Add local folder or repository" icon={<Folder size={16} />} onSelect={onAddFolder} />
      </div>

      <div className="group">
        {folders.length === 0 && <p className="empty-row">No sessions yet</p>}
        {folders.map((folder) => {
          const inFolder = newFirst.filter((session) => session.sourcePath === folder.path)
          const empty = inFolder.length === 0
          const status = folder.collapsed ? groupState(inFolder.map(stateOf)) : null
          const describedBy = `group-state-${folder.id}`
          return (
            <Fragment key={folder.id}>
              <div className="group-row" onContextMenu={onContextMenu(folder, empty)}>
                <button
                  type="button"
                  className="row group-toggle"
                  aria-expanded={!folder.collapsed}
                  aria-describedby={status ? describedBy : undefined}
                  title={folder.path}
                  onClick={() => onToggleFolder(folder.id, !folder.collapsed)}
                >
                  <Folder size={18} className="group-folder" aria-hidden />
                  {folder.collapsed ? (
                    <ChevronRight size={18} className="group-chevron" aria-hidden />
                  ) : (
                    <ChevronDown size={18} className="group-chevron" aria-hidden />
                  )}
                  <span className="row-label">{baseName(folder.path)}</span>
                  {status && <StateIcon state={status} />}
                </button>
                <button type="button" className="group-plus" aria-label={`New session in ${baseName(folder.path)}`} onClick={() => newSessionIn(folder)}>
                  <Plus size={16} aria-hidden />
                </button>
              </div>
              {status && (
                <span id={describedBy} hidden>
                  {status}
                </span>
              )}
              {!folder.collapsed && empty && <p className="empty-row child">No sessions yet</p>}
              {!folder.collapsed &&
                inFolder.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    state={stateOf(session)}
                    active={view.kind === 'session' && view.sessionId === session.id}
                    onClick={() => onGo({ kind: 'session', sessionId: session.id })}
                  />
                ))}
            </Fragment>
          )
        })}
      </div>

      <div
        id={FOLDER_MENU}
        ref={folderMenu}
        className="popover folder-menu"
        popover="auto"
        role="group"
        aria-label="Folder options"
        style={menuTarget ? { left: menuTarget.x, top: menuTarget.y } : undefined}
        onToggle={(event) => {
          if (event.newState === 'closed') setMenuTarget(null)
        }}
      >
        {menuTarget && (
          <>
            <MenuOption menu={FOLDER_MENU} title="New session" icon={<Plus size={16} />} onSelect={() => newSessionIn(menuTarget.folder)} />
            <hr />
            <MenuOption
              menu={FOLDER_MENU}
              title="Remove folder"
              note={menuTarget.empty ? undefined : 'Delete its sessions first'}
              icon={<Trash2 size={16} />}
              danger
              disabled={!menuTarget.empty}
              onSelect={() => onRemoveFolder(menuTarget.folder.id)}
            />
          </>
        )}
      </div>
    </nav>
  )
}
