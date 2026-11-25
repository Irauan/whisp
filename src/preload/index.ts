import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { AgentRun } from '../shared/agent'
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
    ipcRenderer.invoke('repository:issues', folder, githubLogin),
  listAgents: () => ipcRenderer.invoke('agents:list'),
  getAgentRun: (itemId) => ipcRenderer.invoke('agent:get', itemId),
  sendToAgent: (message) => ipcRenderer.invoke('agent:send', message),
  cancelAgent: (itemId) => ipcRenderer.invoke('agent:cancel', itemId),
  answerAgent: (itemId, choiceId) => ipcRenderer.invoke('agent:answer', itemId, choiceId),
  forgetAgentRun: (itemId) => ipcRenderer.invoke('agent:forget', itemId),
  onAgentRun: (callback) => {
    const listener = (_event: IpcRendererEvent, run: AgentRun) => callback(run)
    ipcRenderer.on('agent:run', listener)
    return () => ipcRenderer.removeListener('agent:run', listener)
  }
}

contextBridge.exposeInMainWorld('aether', bridge)
