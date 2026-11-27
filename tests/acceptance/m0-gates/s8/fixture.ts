// The fixture of the acceptance tests of m0-gates S8: the built app, in a temporary data folder,
// with a fake GitHub CLI first on PATH. The product has no test hook.
//
// - The app finds the temporary folder through the Chromium switch `--user-data-dir`, as in S5.
// - The fake `gh` holds two fake accounts. The tests use no real account and no network.
// - Each test also checks that the app did not change the real data folder (`%APPDATA%\aether`).
//
// Two probes look into the app from the outside:
// - The fake `gh` writes one file per call. A test counts them to know if a handler ran.
// - A probe in the main process records each `ipcRenderer.invoke` call that reaches a handler.
//   Electron 45 keeps the handlers of `ipcMain.handle` in the internal map `_invokeHandlers`.
//   The probe wraps each handler in that map, also the ones that the app adds later. The wrapper
//   records the channel and the arguments, then calls the handler with the same arguments.
//   The bridge in the renderer is frozen, so a probe there cannot work.
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { _electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { windowArgs } from '../../support/windows'

const ROOT = resolve(__dirname, '../../../..')

/**
 * The contract of the GitHub accounts query. The plan of m0-gates named it
 * `workspaces.list-github-accounts`. User decision, 2026-11-26: "Profile" everywhere, so its name
 * is now `profiles.list-github-accounts`.
 */
export const LIST_GITHUB_ACCOUNTS = 'profiles.list-github-accounts'

/** The two fake accounts that the fake `gh` reports. */
export const ACCOUNTS = [
  { login: 'example-user-one', name: 'Example User One' },
  { login: 'example-user-two', name: 'Example User Two' }
] as const

/** The answer of `gh auth status --json hosts`, in the format of the GitHub CLI. */
function authStatus(): string {
  return JSON.stringify({
    hosts: {
      'github.com': ACCOUNTS.map(({ login }, index) => ({
        state: 'success',
        active: index === 0,
        host: 'github.com',
        login,
        tokenSource: 'keyring',
        scopes: 'repo, read:org',
        gitProtocol: 'https'
      }))
    }
  })
}

/** The key of an answer file of the fake `gh`. `fake-gh.cs` computes the same key. */
const answerKey = (args: string[]) => args.join(' ').replace(/[^A-Za-z0-9-]/g, '_')

/** The fake GitHub CLI, compiled into its own folder. That folder goes first on PATH. */
export class FakeGh {
  private constructor(readonly folder: string) {}

  static async install(folder: string): Promise<FakeGh> {
    await mkdir(join(folder, 'answers'), { recursive: true })
    await mkdir(join(folder, 'calls'), { recursive: true })
    const windows = process.env.WINDIR ?? process.env.SystemRoot ?? 'C:\\Windows'
    const compiler = join(windows, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
    try {
      await promisify(execFile)(compiler, ['-nologo', `-out:${join(folder, 'gh.exe')}`, join(__dirname, 'fake-gh.cs')], {
        windowsHide: true
      })
    } catch (error) {
      throw new Error(`The fixture could not compile the fake gh with ${compiler}: ${String(error)}`)
    }
    const answers: [string[], string][] = [
      [['auth', 'status', '--json', 'hosts'], authStatus()],
      ...ACCOUNTS.map(({ login, name }): [string[], string] => [
        ['api', `users/${login}`],
        // No `avatar_url`: the app then reads no picture from the network.
        JSON.stringify({ login, name, type: 'User' })
      ])
    ]
    for (const [args, answer] of answers) {
      await writeFile(join(folder, 'answers', `${answerKey(args)}.json`), answer)
    }
    return new FakeGh(folder)
  }

  /** The arguments of each call so far, in no order. */
  async calls(): Promise<string[]> {
    const names = await readdir(join(this.folder, 'calls'))
    return Promise.all(names.map((name) => readFile(join(this.folder, 'calls', name), 'utf8')))
  }
}

/** The outcome of one `invoke` call in a window. */
export type Outcome = { settled: 'resolved'; value: unknown } | { settled: 'rejected'; message: string }

/** An error outcome: the call rejects, or it resolves to a `Result` with `ok: false`. */
export function isError(outcome: Outcome): boolean {
  if (outcome.settled === 'rejected') return true
  const { value } = outcome
  return typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false
}

/** The script that runs `window.aether.invoke` in a window and reports the outcome. */
function invokeScript(name: string, input: unknown): string {
  return `(async () => {
    if (typeof window.aether?.invoke !== 'function') {
      return { settled: 'missing', message: 'window.aether.invoke is missing: the preload exposes no invoke.' }
    }
    try {
      const value = await window.aether.invoke(${JSON.stringify(name)}, ${JSON.stringify(input)})
      return { settled: 'resolved', value: value === undefined ? null : JSON.parse(JSON.stringify(value)) }
    } catch (error) {
      return { settled: 'rejected', message: String(error) }
    }
  })()`
}

function checked(outcome: Outcome | { settled: 'missing'; message: string }): Outcome {
  // A missing `invoke` is the missing feature. It must not count as an error outcome.
  if (outcome.settled === 'missing') throw new Error(outcome.message)
  return outcome
}

export interface GithubApp {
  app: ElectronApplication
  page: Page
  gh: FakeGh
  root: string
  dataDir: string
  /** Calls `window.aether.invoke(name, input)` in the main window of the app. */
  invoke(name: string, input: unknown): Promise<Outcome>
  /**
   * Calls `window.aether.invoke(name, input)` in another frame: the main frame of a second,
   * hidden window with the preload of the app and a page that is not the app.
   */
  invokeFromOtherFrame(name: string, input: unknown): Promise<Outcome>
  /** Each `invoke` call that reached the main process, as JSON text of its channel and arguments. */
  invokes(): Promise<string[]>
}

/** The real data folder of the person who runs the test. The tests must not touch it. */
export function realDataDir(): string {
  const roaming = process.env.APPDATA
  if (!roaming) throw new Error('APPDATA is not set in the test process.')
  return join(roaming, 'aether')
}

/** Lists the files and folders of the user data that the product writes, with their times. */
async function snapshot(folder: string): Promise<string[]> {
  const found: string[] = []
  const visit = async (path: string): Promise<void> => {
    let info
    try {
      info = await stat(path)
    } catch {
      return // Missing: the snapshot records nothing for it.
    }
    found.push(`${relative(folder, path)}|${info.isDirectory() ? 'dir' : info.size}|${info.mtimeMs}`)
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await visit(join(path, name))
    }
  }
  for (const name of ['agents.json', 'workspace.json', 'runs']) await visit(join(folder, name))
  return found
}

/** The environment of the app: the real one, with the fake `gh` first on PATH. */
function appEnvironment(root: string, ghFolder: string): Record<string, string> {
  const env: Record<string, string> = {}
  let path = ''
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    // Windows names the variable `Path`. Keep one name, so the app reads the changed value.
    if (name.toUpperCase() === 'PATH') path = value
    else env[name] = value
  }
  env.PATH = `${ghFolder};${path}`
  // These would run the app as plain Node, load a dev server, or move the data folder.
  for (const name of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'AETHER_DATA_DIR']) delete env[name]
  env.APPDATA = join(root, 'appdata')
  return env
}

/** The built preload script of the app. */
async function preloadScript(): Promise<string> {
  const folder = join(ROOT, 'out', 'preload')
  const names = (await readdir(folder)).filter((name) => /\.(c|m)?js$/.test(name))
  const name = names.includes('index.cjs') ? 'index.cjs' : names[0]
  if (!name) throw new Error(`The build has no preload script in ${folder}. Run "npm run build".`)
  return join(folder, name)
}

export const test = base.extend<{ github: GithubApp }>({
  // Playwright needs the destructured first argument, even when it is empty.
  github: async ({}, use, testInfo) => {
    const root = await mkdtemp(join(tmpdir(), 'aether-acceptance-'))
    const dataDir = join(root, 'data')
    await mkdir(dataDir, { recursive: true })
    await mkdir(join(root, 'appdata'), { recursive: true })
    const gh = await FakeGh.install(join(root, 'gh'))
    const preload = await preloadScript()

    // The real folder before the app starts. The check at the end covers the start and the exit.
    const realBefore = await snapshot(realDataDir())

    // One account without a GitHub account, and no projects.
    await writeFile(
      join(dataDir, 'workspace.json'),
      JSON.stringify(
        {
          version: 4,
          accounts: [{ id: 'personal', label: 'Personal', github: null }],
          currentAccountId: 'personal',
          projects: [],
          workItems: [],
          sessions: []
        },
        null,
        2
      )
    )

    const app = await _electron.launch({
      args: windowArgs([ROOT, `--user-data-dir=${dataDir}`]),
      cwd: ROOT,
      env: appEnvironment(root, gh.folder)
    })
    const page = await app.firstWindow()
    await app.context().tracing.start({ screenshots: true, snapshots: true })

    await app.evaluate(({ BrowserWindow, ipcMain }) => {
      type Handler = (event: unknown, ...args: unknown[]) => unknown
      const records: string[] = []
      ;(globalThis as { aetherTestInvokes?: string[] }).aetherTestInvokes = records
      const wrap =
        (channel: string, handler: Handler): Handler =>
        (event, ...args) => {
          try {
            records.push(JSON.stringify([channel, ...args]))
          } catch {
            records.push(JSON.stringify([channel]))
          }
          return handler(event, ...args)
        }
      const targets = [
        ipcMain,
        ...BrowserWindow.getAllWindows().flatMap((window) => [window.webContents.ipc, window.webContents.mainFrame.ipc])
      ]
      for (const target of targets) {
        const handlers = (target as unknown as { _invokeHandlers?: unknown })._invokeHandlers
        if (!(handlers instanceof Map)) {
          throw new Error('The fixture found no map of invoke handlers in Electron. Its probe needs an update.')
        }
        const map = handlers as Map<string, Handler>
        for (const [channel, handler] of map) map.set(channel, wrap(channel, handler))
        // A handler that the app adds later is recorded too.
        const set = map.set.bind(map)
        map.set = (channel: string, handler: Handler) => set(channel, wrap(channel, handler))
      }
    })

    const github: GithubApp = {
      app,
      page,
      gh,
      root,
      dataDir,
      invoke: async (name, input) => checked(await page.evaluate(invokeScript(name, input))),
      invokeFromOtherFrame: async (name, input) =>
        checked(
          await app.evaluate(
            async ({ BrowserWindow }, { preload, script }) => {
              const other = new BrowserWindow({
                show: false,
                webPreferences: { preload, contextIsolation: true, sandbox: true }
              })
              try {
                await other.loadURL('data:text/html,<!doctype html><title>Another frame</title>')
                return await other.webContents.executeJavaScript(script)
              } finally {
                other.destroy()
              }
            },
            { preload, script: invokeScript(name, input) }
          )
        ),
      invokes: () =>
        app.evaluate(() => [...((globalThis as { aetherTestInvokes?: string[] }).aetherTestInvokes ?? [])])
    }

    try {
      await use(github)
    } finally {
      const failed = testInfo.status !== testInfo.expectedStatus
      await app
        .context()
        .tracing.stop(failed ? { path: testInfo.outputPath('trace.zip') } : {})
        .catch(() => undefined)
      await app.close().catch(() => undefined)
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined)
      // The app is gone. The real folder must have the same files, with the same times.
      expect(await snapshot(realDataDir()), 'The app changed the real user data folder.').toEqual(realBefore)
    }
  }
})

export { expect }
