import { Check, ChevronsUpDown, Plus, Settings, Users } from 'lucide-react'
import type { WorkspaceView } from '../useWorkspaces'
import { Avatar, githubNote } from './Avatar'

const MENU_ID = 'workspace-menu'
const closesMenu = { popoverTarget: MENU_ID, popoverTargetAction: 'hide' } as const

interface Props {
  workspaces: WorkspaceView[]
  /** Null when no workspace exists. */
  current: WorkspaceView | null
  onSwitch(workspaceId: string): void
  onSettings(): void
  onAdd(): void
  onManage(): void
}

export function WorkspaceSwitcher({ workspaces, current, onSwitch, onSettings, onAdd, onManage }: Props) {
  return (
    <div className="account-bar">
      <button type="button" className="row account-button" popoverTarget={MENU_ID}>
        {current && <Avatar workspace={current} size={26} />}
        <span className="row-label">{current?.name ?? 'No workspace'}</span>
        <span className="row-note">{current?.github && githubNote(current)}</span>
        <ChevronsUpDown size={16} />
      </button>
      <div id={MENU_ID} className="menu" popover="auto" role="group" aria-label="Workspaces">
        {current && (
          <>
            <div className="menu-head">
              <Avatar workspace={current} size={36} />
              <div>
                <p>{current.github?.name ?? current.name}</p>
                <p className="muted">{githubNote(current)}</p>
              </div>
            </div>
            <hr />
          </>
        )}
        {workspaces.map((workspace) => (
          <button
            key={workspace.id}
            type="button"
            className="row"
            aria-current={workspace.id === current?.id ? 'true' : undefined}
            onClick={() => onSwitch(workspace.id)}
            {...closesMenu}
          >
            <Avatar workspace={workspace} size={20} />
            <span className="row-label">{workspace.name}</span>
            {workspace.id === current?.id && <Check size={16} />}
          </button>
        ))}
        {workspaces.length > 0 && <hr />}
        {current && (
          <button type="button" className="row" onClick={onSettings} {...closesMenu}>
            <Settings size={18} />
            <span className="row-label">Workspace settings</span>
          </button>
        )}
        <button type="button" className="row" onClick={onAdd} {...closesMenu}>
          <Plus size={18} />
          <span className="row-label">Add workspace</span>
        </button>
        <button type="button" className="row" onClick={onManage} {...closesMenu}>
          <Users size={18} />
          <span className="row-label">Manage workspaces</span>
        </button>
      </div>
    </div>
  )
}
