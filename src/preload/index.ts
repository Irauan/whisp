import { contextBridge, ipcRenderer } from 'electron'
import type { AetherBridge } from '../shared/bridge'

const bridge: AetherBridge = {
  platform: process.platform,
  loadWorkspace: () => ipcRenderer.invoke('workspace:load'),
  saveWorkspace: (workspace) => ipcRenderer.invoke('workspace:save', workspace)
}

contextBridge.exposeInMainWorld('aether', bridge)
