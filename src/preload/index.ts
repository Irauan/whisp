import { contextBridge, ipcRenderer } from 'electron'
import type { AetherBridge } from '../shared/bridge'

const bridge: AetherBridge = {
  platform: process.platform,
  loadWorkspace: () => ipcRenderer.invoke('workspace:load'),
  saveWorkspace: (workspace) => ipcRenderer.invoke('workspace:save', workspace),
  listGithubAccounts: () => ipcRenderer.invoke('github:accounts'),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  chooseFolders: () => ipcRenderer.invoke('folders:choose'),
  chooseFiles: () => ipcRenderer.invoke('files:choose'),
  inspectFolder: (folder) => ipcRenderer.invoke('folder:inspect', folder),
  listRepositoryFiles: (folder) => ipcRenderer.invoke('repository:files', folder),
  listIssues: (folder, githubLogin) =>
    ipcRenderer.invoke('repository:issues', folder, githubLogin)
}

contextBridge.exposeInMainWorld('aether', bridge)
