import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import iconIco from '../../resources/icon.ico?asset'
import iconPng from '../../resources/icon.png?asset'
import { contracts, events } from '../app/contracts'
import { composeMain, type Composition } from '../app/main/composition'
import { createInvoke, createSubscribe } from '../app/main/ipc'
import { AcpAgents } from '../providers/acp/acp-agents'
import { claudeCodeRecipe } from '../providers/claude-code/claude-code'
import { GithubCli } from '../providers/github-cli/github-cli'
import { INVOKE_CHANNEL, SUBSCRIBE_CHANNEL } from '../shared/channels'
import { AgentRegistry } from './agents/registry'
import { chooseFiles, chooseFolder, chooseFolders, inspectFolder } from './folders'
import { git, listRepositoryFiles } from './repository'

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

/** The database and the controllers. They exist after the start, before the first window. */
let main: Composition | null = null

/** Opens the database, runs the import and connects the handlers of `invoke` and `subscribe`. */
function startMain(): void {
  const dataDir = app.getPath('userData')
  // An entry `claude-code` in `agents.json` replaces only the program and the arguments of the Claude recipe.
  const registry = new AgentRegistry(join(dataDir, 'agents.json'))
  const agents = new AcpAgents({ recipe: claudeCodeRecipe({ override: () => registry.claudeCodeOverride() }) })
  const subscription = createSubscribe({ events, isTrusted: isAppFrame })
  const composed = composeMain({ dataDir, github, agents, publish: subscription.publish })
  if (!composed.ok) {
    // A newer database, or a failure that Aether cannot repair. Aether writes nothing and exits.
    dialog.showErrorBox('Aether could not start', composed.error.message)
    app.exit(1)
    return
  }
  main = composed.value
  const invoke = createInvoke({
    contracts,
    controllers: main.controllers,
    isTrusted: isAppFrame,
    log: (message, cause) => console.error(message, cause)
  })
  ipcMain.handle(INVOKE_CHANNEL, (event, name: unknown, input: unknown) => invoke(event, name, input))
  ipcMain.handle(SUBSCRIBE_CHANNEL, (event, name: unknown) => subscription.handler(event, name))
}

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

// Before Aether quits, end the agent processes: cancel, close, and kill the process trees after a limit.
// The quit goes on when they are gone. Each change is one transaction, so no save is in progress at the exit.
let quitting = false
app.on('before-quit', (event) => {
  if (quitting || !main) return
  quitting = true
  event.preventDefault()
  void main.shutdown().then(
    () => app.quit(),
    (cause: unknown) => {
      console.error('Aether could not end the agent processes.', cause)
      app.quit()
    }
  )
})

// Close the database.
app.on('will-quit', () => main?.close())

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
      startMain()
      if (!main) return
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
