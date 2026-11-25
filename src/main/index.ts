import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import iconIco from '../../resources/icon.ico?asset'
import iconPng from '../../resources/icon.png?asset'
import { isWorkspace } from '../shared/model'
import { chooseFiles, chooseFolder, chooseFolders, inspectFolder } from './folders'
import { listGithubAccounts, listIssues } from './github'
import { listRepositoryFiles } from './repository'
import { WorkspaceFile } from './workspace-file'

if (process.env.AETHER_DATA_DIR) app.setPath('userData', process.env.AETHER_DATA_DIR)

const hasLock = app.requestSingleInstanceLock()
if (!hasLock) app.quit()

const file = new WorkspaceFile(join(app.getPath('userData'), 'workspace.json'))

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 520,
    show: false,
    icon: process.platform === 'win32' ? iconIco : iconPng,
    backgroundColor: '#0a0515',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0a0515', symbolColor: '#a89cbd', height: 44 },
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

function asText(value: unknown): string {
  if (typeof value !== 'string') throw new Error('The value must be text.')
  return value
}

ipcMain.handle('workspace:load', () => file.load())
ipcMain.handle('workspace:save', (_event, workspace: unknown) => {
  if (!isWorkspace(workspace)) throw new Error('Refused to save data that is not a workspace.')
  return file.save(workspace)
})
ipcMain.handle('github:accounts', () => listGithubAccounts())
ipcMain.handle('folder:choose', () => chooseFolder())
ipcMain.handle('folders:choose', () => chooseFolders())
ipcMain.handle('files:choose', () => chooseFiles())
ipcMain.handle('folder:inspect', (_event, folder: unknown) => inspectFolder(asText(folder)))
ipcMain.handle('repository:files', (_event, folder: unknown) => listRepositoryFiles(asText(folder)))
ipcMain.handle('repository:issues', (_event, folder: unknown, login: unknown) =>
  listIssues(asText(folder), login === null ? null : asText(login))
)

// Finish the saves in progress before the app exits.
let settled = false
app.on('before-quit', (event) => {
  if (settled) return
  event.preventDefault()
  void file.settled().then(() => {
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
