import type { Workspace } from './model'

export interface AetherBridge {
  platform: string
  loadWorkspace(): Promise<Workspace>
  saveWorkspace(workspace: Workspace): Promise<void>
}
