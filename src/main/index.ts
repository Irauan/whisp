import { stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import iconIco from '../../resources/icon.ico?asset'
import iconPng from '../../resources/icon.png?asset'
import { isWorkspace } from '../shared/model'
import { AgentHost } from './agents/host'
import { AgentRegistry } from './agents/registry'
import { isItemId, RunStore } from './agents/run-store'
import { WorkspaceFile } from './workspace-file'

if (process.env.AETHER_DATA_DIR) app.setPath('userData', process.env.AETHER_DATA_DIR)

const hasLock = app.requestSingleInstanceLock()
if (!hasLock) app.quit()

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
    backgroundColor: '#060807',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#060807', symbolColor: '#9aa8a0', height: 44 },
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true
    }
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // Allow a reload of the current page only. Hot reload needs it.
  window.webContents.on('will-navigate', (event) => {
    if (event.url !== window.webContents.getURL()) event.preventDefault()
  })

  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer && !app.isPackaged) void window.loadURL(devServer)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
}

ipcMain.handle('workspace:load', () => file.load())
ipcMain.handle('workspace:save', (_event, workspace: unknown) => {
  if (!isWorkspace(workspace)) throw new Error('Refused to save data that is not a workspace.')
  return file.save(workspace)
})

ipcMain.handle('folder:choose', async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  const options = { title: 'Choose the project folder', properties: ['openDirectory' as const, 'createDirectory' as const] }
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
  return result.canceled ? null : (result.filePaths[0] ?? null)
})

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
