import type { WorkspaceView } from '../useWorkspaces'

export function Avatar({ workspace, size }: { workspace: WorkspaceView; size: number }) {
  if (workspace.github?.avatar) {
    return <img className="avatar" src={workspace.github.avatar} width={size} height={size} alt="" />
  }
  return (
    <span className="avatar" style={{ width: size, height: size }} aria-hidden="true">
      {workspace.name.slice(0, 1).toUpperCase()}
    </span>
  )
}

export function githubNote(workspace: WorkspaceView): string {
  return workspace.github ? `@${workspace.github.login}` : 'No GitHub account'
}
