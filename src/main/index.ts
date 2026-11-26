import { stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import iconIco from '../../resources/icon.ico?asset'
import iconPng from '../../resources/icon.png?asset'
import { contracts, events } from '../app/contracts'
import { createInvoke, createSubscribe } from '../app/main/ipc'
import { listGithubAccounts } from '../features/workspaces/list-github-accounts/list-github-accounts.contract'
import { listGithubAccountsController } from '../features/workspaces/list-github-accounts/list-github-accounts.controller'
import { GithubCli } from '../providers/github-cli/github-cli'
import type { GithubAccounts } from '../shared/bridge'
import { INVOKE_CHANNEL, SUBSCRIBE_CHANNEL } from '../shared/channels'
import { isWorkspace } from '../shared/model'
import { AgentHost } from './agents/host'
import { AgentRegistry } from './agents/registry'
import { isItemId, RunStore } from './agents/run-store'
import { chooseFiles, chooseFolder, chooseFolders, inspectFolder } from './folders'
import { git, listRepositoryFiles } from './repository'
import { WorkspaceFile } from './workspace-file'

if (process.env.AETHER_DATA_DIR) app.setPath('userData', process.env.AETHER_DATA_DIR)

const hasLock = app.requestSingleInstanceLock()
if (!hasLock) app.quit()

const github = new GithubCli()

/** The pages of Aether: the built file, or the dev server in a dev run. */
const devServer = process.env.ELECTRON_RENDERER_URL
const appPage = pathToFileURL(join(__dirname, '../renderer/index.html')).href

/** The web contents of the windows that Aether created. */
const appWindows = new Set<number>()

/** True only for the main frame of an Aether window, with the page of Aether. */
function isAppFrame(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  if (!frame || !appWindows.has(event.sender.id) || frame !== event.sender.mainFrame) return false
  const address = frame.url.split(/[?#]/)[0] ?? ''
  if (devServer && !app.isPackaged) return frame.url.startsWith(devServer)
  return address === appPage
}

const invoke = createInvoke({
  contracts,
  controllers: { [listGithubAccounts.name]: listGithubAccountsController(github) },
  isTrusted: isAppFrame,
  log: (message, cause) => console.error(message, cause)
})
const subscription = createSubscribe({ events, isTrusted: isAppFrame })
ipcMain.handle(INVOKE_CHANNEL, (event, name: unknown, input: unknown) => invoke(event, name, input))
ipcMain.handle(SUBSCRIBE_CHANNEL, (event, name: unknown) => subscription.handler(event, name))

const file = new WorkspaceFile(join(app.getPath('userData'), 'workspace.json'))
const registry = new AgentRegistry(join(app.getPath('userData'), 'agents.json'))
const agents = new AgentHost(registry, new RunStore(join(app.getPath('userData'), 'runs')), (run) => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('agent:run', run)
})

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    show: false,
    icon: process.platform === 'win32' ? iconIco : iconPng,
    backgroundColor: '#070709',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#070709', symbolColor: '#9d9ea6', height: 44 },
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true
    }
  })
  const contentsId = window.webContents.id
  appWindows.add(contentsId)
  window.once('closed', () => appWindows.delete(contentsId))
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // Allow a reload of the current page only. Hot reload needs it.
  window.webContents.on('will-navigate', (event) => {
    if (event.url !== window.webContents.getURL()) event.preventDefault()
  })

  if (devServer && !app.isPackaged) void window.loadURL(devServer)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
}

function asText(value: unknown): string {
  if (typeof value !== 'string') throw new Error('The value must be text.')
  return value
}

ipcMain.handle('workspace:load', () => file.load())
ipcMain.handle('workspace:save', (_event, workspace: unknown) => {
  if (!isWorkspace(workspace)) throw new Error('Refused to save data that is not a workspace.')
  return file.save(workspace)
})
// The old channel. The renderer reads the accounts through `invoke` now. m1-chat removes this one.
ipcMain.handle('github:accounts', async (): Promise<GithubAccounts> => {
  const result = await github.listAccounts()
  return result.ok ? { ok: true, profiles: result.value } : { ok: false, reason: result.error.message }
})
ipcMain.handle('folder:choose', () => chooseFolder())
ipcMain.handle('folders:choose', () => chooseFolders())
ipcMain.handle('files:choose', () => chooseFiles())
ipcMain.handle('folder:inspect', (_event, folder: unknown) => inspectFolder(asText(folder)))
ipcMain.handle('repository:files', (_event, folder: unknown) => listRepositoryFiles(asText(folder)))
ipcMain.handle('repository:issues', (_event, folder: unknown, login: unknown) =>
  github.listIssues(asText(folder), login === null ? null : asText(login), (path) =>
    git(path, ['remote', 'get-url', 'origin'])
  )
)

async function isFolder(path: unknown): Promise<boolean> {
  if (typeof path !== 'string' || !isAbsolute(path)) return false
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

function requireItemId(itemId: unknown): string {
  if (!isItemId(itemId)) throw new Error('Not a work item id.')
  return itemId
}

ipcMain.handle('agents:list', () => registry.info())
ipcMain.handle('agent:get', (_event, itemId: unknown) => agents.get(requireItemId(itemId)))
ipcMain.handle('agent:send', async (_event, request: unknown) => {
  const { itemId, agentId, cwd, text } = (request ?? {}) as Record<string, unknown>
  if (typeof agentId !== 'string' || typeof text !== 'string') throw new Error('Not a message for an agent.')
  if (!(await isFolder(cwd))) throw new Error('The project folder does not exist.')
  // Resolves when the turn ends. Its progress arrives as agent:run events, and
  // only a message that cannot start rejects.
  return agents.send({ itemId: requireItemId(itemId), agentId, cwd: cwd as string, text })
})
ipcMain.handle('agent:cancel', (_event, itemId: unknown) => agents.cancel(requireItemId(itemId)))
ipcMain.handle('agent:answer', (_event, itemId: unknown, choiceId: unknown) =>
  agents.answer(requireItemId(itemId), typeof choiceId === 'string' ? choiceId : null)
)
ipcMain.handle('agent:forget', (_event, itemId: unknown) => agents.forget(requireItemId(itemId)))

// Finish the saves in progress, and stop the agents, before the app exits.
let settled = false
app.on('before-quit', (event) => {
  if (settled) return
  event.preventDefault()
  void Promise.all([file.settled(), agents.shutdown()]).then(() => {
    settled = true
    app.quit()
  })
})

app.on('second-instance', () => {
  const [window] = BrowserWindow.getAllWindows()
  if (!window) return
  if (window.isMinimized()) window.restore()
  window.focus()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

if (hasLock) {
  app
    .whenReady()
    .then(() => {
      createWindow()
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
      })
    })
    .catch((error: unknown) => {
      dialog.showErrorBox('Aether could not start', String(error))
      app.exit(1)
    })
}
