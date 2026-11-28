// The fixture of the S4 tests of milestone m1-chat: A1, A2, A3, A6, A7, A8, A16 and A20, and G11
// and G12 of m0-gates, which these tests replace (user decision, 2026-11-26).
//
// The setup. All data is fake. The product has no test hook.
// - The built app runs in a temporary data folder. It finds the folder through the Chromium switch
//   `--user-data-dir`, as in S2. The app process also gets a temporary `APPDATA`, `USERPROFILE`
//   and `HOME`, so that a mistake cannot reach a real Claude folder or the real data folder.
// - The fixture checks that the real data folder (`%APPDATA%\aether`) has the same files, with the
//   same times, before the first start and after the last exit (G11).
// - The simulated agent is registered in `agents.json` of the data folder, under the id
//   `claude-code`, with the name "Claude Code". Each test controls it through its control pipe.
// - The app gets no Anthropic or Claude variable, and no `GH_TOKEN`, from the environment of the
//   test. A test can add variables to the environment of the app (A16).
// - The fake GitHub CLI of m0-gates S8 is first on PATH. It also answers the token query below.
// - The profile "Personal" comes from an old `workspace.json`, as in S2 and S3. Its workspace
//   directory R holds plain folders `repo-a` and `repo-b`: no Git repository, no hook, no `.mcp.json`.
//
// Trust in S4. The trust question comes in story S6, and no S4 test answers it. S4 reads "trusted"
// in A1 as "a folder for which Aether asks nothing": a plain folder under the workspace directory.
// S6 decides how its question treats these folders, and adapts this fixture if it must.
//
// No test sleeps. A test waits on an auto-waiting check of Playwright, or on a report of the
// simulated agent through `reach`, which fails with a message when the report does not come.
//
// The UI that these tests expect (S4 test contract). The S1, S2 and S3 contracts stay.
// - Agent: an entry of `agents.json` with the id `claude-code` replaces the program and the
//   arguments of the launch recipe of Claude Code. Each session then runs that program.
// - "Start session" in the composer of a new session creates the session, opens its window, and
//   sends the prompt as the first message (flow 2).
// - The session window has a composer: the text field "Prompt" and the button "Send". In a draft,
//   "Prompt" holds the prompt of the draft, and "Send" starts the session with it (flow 6). After
//   a send, "Prompt" is empty.
// - During a turn (states Starting, Working, Waiting for permission), the composer has the button
//   "Stop". Stop cancels the turn.
// - The state Starting shows the text "Starting Claude Code". The state Working shows the exact
//   text "Working". Neither shows in the state Idle.
// - The transcript: an element with the role `log` and the name "Transcript". It shows the text of
//   the user and of the agent, in order. Streamed text shows as it comes.
// - A tool call in the transcript: an element with the role `group`, named by the title of the
//   tool call. Its status shows in it as text. A failed tool call shows "Failed".
// - Stop: the transcript then shows the exact text "Stopped.", and each open tool call shows "Failed".
// - Notices of the states Not signed in and Agent stopped: an element with the role `alert` in the
//   session window.
//   - Not signed in: "Claude Code is not signed in.", followed by the sign-in steps of the profile.
//   - Agent stopped: the exit code as "exit code <n>", and the last log lines of the agent.
// - Ready composer: no "Stop", the text field "Prompt" can take text, and "Send" is then enabled.
// - Mode: Aether sends `session/set_mode` with the Claude mode of the session (Ask gives `default`)
//   on the agent session, before the first `session/prompt` (plan, S4 defect "no permission mode").
// - Profile settings (the S2 dialog): the profile menu (the first button whose name starts with the
//   profile name) opens the `group` "Profiles". Its button "Profile settings" opens the `dialog`
//   "Profile settings". The dialog has the text field "Claude folder" with the Claude folder of the
//   profile, and the button "Save", which saves and closes it.
// - Provider snapshot (decision 0013): the agent process of a session gets `CLAUDE_CONFIG_DIR` from
//   the Claude settings of its first start, also after a later change of the profile and a restart.
//   A new session gets the current Claude folder of the profile.
// - GH_TOKEN: Aether reads the token of the GitHub account of the profile with
//   `gh auth token --hostname github.com --user <login>`, as `src/providers/github-cli` does.
import { copyFile, mkdir, mkdtemp, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { ControlServer, type AcpMessage, type ProcessMessage } from '../../../simulated-agent/control'
import { FakeGh } from '../../m0-gates/s8/fixture'
import { answerDirectoryDialog, DATABASE, SavedData, type Mode, type Row } from '../s2/fixture'
import { windowArgs } from '../../support/windows'

export { expect }
export { holds, holdsPath, modesOf, SavedData, type Row } from '../s2/fixture'
export { main, openNewSession, sessionEntry, sidebar, startSession } from '../s3/fixture'

const ROOT = resolve(__dirname, '../../../..')

export const PROFILE = 'Personal'

/** The fake GitHub accounts of the fake `gh` (m0-gates S8). The first one is the active account of `gh`. */
export const GITHUB = { one: 'example-user-one', two: 'example-user-two' } as const

/** The fake token that the fake `gh` gives for each login. No real token has this form. */
export const tokenOf = (login: string) => `fake-token-of-${login}`

/** The fake token of the active account of `gh`, for a token query without a login. */
export const ACTIVE_ACCOUNT_TOKEN = 'fake-token-of-the-active-account'

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
  // The files that Aether writes, and the copies that it keeps aside. Chromium caches are not part of the check.
  let names: string[] = []
  try {
    names = (await readdir(folder)).filter((name) => /^(agents|workspace|runs|aether)/i.test(name)).sort()
  } catch {
    return found // No real data folder.
  }
  for (const name of names) await visit(join(folder, name))
  return found
}

/** The names of the variables that the test process must not pass to the app. */
const isClaudeOrToken = (name: string) => /^(ANTHROPIC_|CLAUDE_)/i.test(name) || /^(GH_TOKEN|GITHUB_TOKEN)$/i.test(name)

/** The environment of the app: the real one without Claude, Anthropic and token variables, the fake `gh` first on PATH. */
function appEnvironment(root: string, ghFolder: string, extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  let path = ''
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined || isClaudeOrToken(name)) continue
    // Windows names the variable `Path`. Keep one name, so the app reads the changed value.
    if (name.toUpperCase() === 'PATH') path = value
    else env[name] = value
  }
  env.PATH = `${ghFolder};${path}`
  // These would run the app as plain Node, load a dev server, or move the data folder.
  for (const name of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'AETHER_DATA_DIR']) delete env[name]
  env.APPDATA = join(root, 'appdata')
  env.USERPROFILE = join(root, 'home')
  env.HOME = join(root, 'home')
  return { ...env, ...extra }
}

/** The key of an answer file of the fake `gh`. `fake-gh.cs` computes the same key. */
const answerKey = (args: string[]) => args.join(' ').replace(/[^A-Za-z0-9-]/g, '_')

/** Adds the answers of the token query to the fake `gh`: one fake token for each login. */
async function addTokenAnswers(gh: FakeGh): Promise<void> {
  const answers: [string[], string][] = [[['auth', 'token'], ACTIVE_ACCOUNT_TOKEN]]
  answers.push([['auth', 'token', '--hostname', 'github.com'], ACTIVE_ACCOUNT_TOKEN])
  for (const login of Object.values(GITHUB)) {
    answers.push([['auth', 'token', '--hostname', 'github.com', '--user', login], tokenOf(login)])
    answers.push([['auth', 'token', '--user', login, '--hostname', 'github.com'], tokenOf(login)])
    answers.push([['auth', 'token', '--user', login], tokenOf(login)])
  }
  for (const [args, answer] of answers) {
    await writeFile(join(gh.folder, 'answers', `${answerKey(args)}.json`), `${answer}\n`)
  }
}

export interface ChatApp {
  /** The temporary folder that holds everything of this test. */
  root: string
  /** The data folder of the app (`userData`), inside `root`. */
  dataDir: string
  /** The workspace directory R of the profile "Personal". */
  directory: string
  /** The control server of the simulated agent. */
  control: ControlServer
  /** The running app. It throws when the app does not run. */
  readonly app: ElectronApplication
  /** Starts the app on the data folder and returns its window. `env` adds variables to the app environment. */
  start(env?: Record<string, string>): Promise<Page>
  /** Closes the app. Its files are then complete. */
  stop(): Promise<void>
  /** Reads a copy of the database. Call it after `stop`. */
  readDatabase(): Promise<SavedData>
}

export const test = base.extend<{ chat: ChatApp }>({
  // Playwright needs the destructured first argument, even when it is empty.
  chat: async ({}, use, testInfo) => {
    // The long form of the path: a short 8.3 name of the temporary folder must not reach the app.
    const root = await realpath(await mkdtemp(join(tmpdir(), 'aether-acceptance-')))
    const dataDir = join(root, 'data')
    const directory = join(root, 'directories', 'personal')
    for (const folder of [dataDir, join(root, 'appdata'), join(root, 'home'), directory]) await mkdir(folder, { recursive: true })
    const gh = await FakeGh.install(join(root, 'gh'))
    await addTokenAnswers(gh)
    const control = await ControlServer.start()
    const { command, args } = control.agent
    await writeFile(
      join(dataDir, 'agents.json'),
      JSON.stringify({ agents: [{ id: 'claude-code', name: 'Claude Code', command, args }] }, null, 2)
    )

    // The real folder before the app starts. The check at the end covers each start and exit (G11).
    const realBefore = await snapshot(realDataDir())

    let running: ElectronApplication | null = null
    let starts = 0
    const stop = async () => {
      if (!running) return
      const app = running
      running = null
      const failed = testInfo.status !== testInfo.expectedStatus
      await app
        .context()
        .tracing.stop(failed ? { path: testInfo.outputPath(`trace-${starts}.zip`) } : {})
        .catch(() => undefined)
      await app.close().catch(() => undefined)
    }

    const chat: ChatApp = {
      root,
      dataDir,
      directory,
      control,
      get app() {
        if (!running) throw new Error('The app does not run.')
        return running
      },
      start: async (env = {}) => {
        if (running) throw new Error('The app runs already. Stop it first.')
        starts += 1
        running = await _electron.launch({
          args: windowArgs([ROOT, `--user-data-dir=${dataDir}`]),
          cwd: ROOT,
          env: appEnvironment(root, gh.folder, env)
        })
        const page = await running.firstWindow()
        await running.context().tracing.start({ screenshots: true, snapshots: true })
        return page
      },
      stop,
      readDatabase: async () => {
        if (running) throw new Error('Stop the app before you read its database.')
        const copy = join(root, `database-copy-${Date.now()}`)
        await mkdir(copy, { recursive: true })
        try {
          await copyFile(join(dataDir, DATABASE), join(copy, DATABASE))
        } catch (error) {
          throw new Error(`The data folder has no database ${DATABASE}: ${String(error)}`)
        }
        for (const suffix of ['-wal', '-shm']) {
          await copyFile(join(dataDir, DATABASE + suffix), join(copy, DATABASE + suffix)).catch(() => undefined)
        }
        const database = new DatabaseSync(join(copy, DATABASE))
        try {
          const tables = database
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
            .all()
            .map((row) => String(row.name))
          const rows: Row[] = []
          for (const table of tables) {
            const quoted = `"${table.replaceAll('"', '""')}"`
            for (const values of database.prepare(`SELECT * FROM ${quoted}`).all()) rows.push({ table, values: { ...values } })
          }
          return new SavedData(rows)
        } finally {
          database.close()
        }
      }
    }

    try {
      await use(chat)
    } finally {
      // Stop the app before the control server, so that no agent loses its pipe while the app runs.
      await stop()
      await control.close()
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined)
      // The app is gone. The real folder must have the same files, with the same times (G11).
      expect(await snapshot(realDataDir()), 'G11: the app changed the real user data folder.').toEqual(realBefore)
    }
  }
})

/** The plain folders of the workspace directory: no Git repository, no hook, no `.mcp.json`. */
export type Folder = 'repo-a' | 'repo-b'
export const folderPath = (chat: ChatApp, folder: Folder) => join(chat.directory, folder)

/** One session draft of the old file. */
export interface Draft {
  prompt: string
  folder: Folder
  /** A mode that the import order gives: interactive and ask give Ask. */
  mode?: Extract<Mode, 'ask'>
  createdAt: string
}

/**
 * Writes the old `workspace.json` of version 4: the profile "Personal", with a GitHub account or
 * none, and its drafts. Creates both folders of the workspace directory.
 */
export async function writeOldProfile(chat: ChatApp, drafts: Draft[], github: string | null = null): Promise<void> {
  for (const folder of ['repo-a', 'repo-b'] as const) await mkdir(folderPath(chat, folder), { recursive: true })
  const profile = {
    version: 4,
    accounts: [
      {
        id: 'personal',
        label: PROFILE,
        github: github === null ? null : { login: github, name: `Example ${github}`, avatar: null }
      }
    ],
    currentAccountId: 'personal',
    projects: [],
    workItems: [],
    sessions: drafts.map((draft, index) => ({
      id: `session-${index + 1}`,
      accountId: 'personal',
      title: draft.prompt,
      prompt: draft.prompt,
      settings: {
        folder: folderPath(chat, draft.folder),
        mode: 'interactive',
        permissions: 'ask',
        model: 'default',
        checkout: 'folder',
        attachments: []
      },
      createdAt: draft.createdAt
    }))
  }
  await writeFile(join(chat.dataDir, 'workspace.json'), JSON.stringify(profile, null, 2))
}

/** One draft in `repo-a`. The composer of a new session then starts with `repo-a`. */
export const DRAFT_IN_REPO_A: Draft = { prompt: 'Rename the old files', folder: 'repo-a', createdAt: '2026-01-01T00:00:00.000Z' }

/** Starts the app on the old file and answers the import dialog of flow 1. */
export async function startImported(chat: ChatApp, env: Record<string, string> = {}): Promise<Page> {
  const page = await chat.start(env)
  await answerDirectoryDialog(page, { [PROFILE]: chat.directory })
  return page
}

// The UI of the S4 contract.

const inMain = (page: Page) => page.getByRole('main')
export const transcript = (page: Page) => inMain(page).getByRole('log', { name: 'Transcript' })
export const promptField = (page: Page) => inMain(page).getByRole('textbox', { name: 'Prompt', exact: true })
export const sendButton = (page: Page) => inMain(page).getByRole('button', { name: 'Send', exact: true })
export const stopButton = (page: Page) => inMain(page).getByRole('button', { name: 'Stop', exact: true })
export const working = (page: Page) => inMain(page).getByText('Working', { exact: true })
export const starting = (page: Page) => inMain(page).getByText('Starting Claude Code')
export const alerts = (page: Page) => inMain(page).getByRole('alert')
export const toolCall = (page: Page, title: string) => transcript(page).getByRole('group', { name: title })

/** Checks that the transcript shows this text as one entry, for example a reply. */
export async function expectInTranscript(page: Page, text: string, message: string): Promise<void> {
  await expect(transcript(page), `${message} The session window has no log "Transcript".`).toBeVisible()
  await expect(transcript(page).getByText(text, { exact: true }), message).toBeVisible()
}

/** Writes a message in the composer of the session window and clicks "Send". */
export async function send(page: Page, text: string, check: string): Promise<void> {
  const field = promptField(page)
  await expect(field, `${check}: the session window has no text field "Prompt".`).toBeEditable()
  await field.fill(text)
  await expect(sendButton(page), `${check}: the button "Send" of the session window is not enabled.`).toBeEnabled()
  await sendButton(page).click()
}

/** Checks the state Idle: no Stop, no "Working", and the composer takes a new message. */
export async function expectReady(page: Page, check: string): Promise<void> {
  await expect(stopButton(page), `${check}: the button "Stop" still shows, so the composer is not ready.`).toHaveCount(0)
  await expect(working(page), `${check}: "Working" still shows after the turn.`).toHaveCount(0)
  const field = promptField(page)
  await expect(field, `${check}: the text field "Prompt" does not take text, so the composer is not ready.`).toBeEditable()
  await field.fill('A next message')
  await expect(sendButton(page), `${check}: "Send" is not enabled for a next message, so the composer is not ready.`).toBeEnabled()
  await field.fill('')
}

/** Checks a locator text against a pattern, in order, for example both turns of a transcript. */
export const inOrder = (...texts: string[]) =>
  new RegExp(texts.map((text) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]*'))

/**
 * Waits for a report of the simulated agent. A control wait has no time limit, so this turns it
 * into a Playwright check that fails with the message.
 */
export async function reach<T>(promise: Promise<T>, message: string): Promise<T> {
  let done = false
  let value: T | undefined
  void promise.then((result) => {
    value = result
    done = true
  })
  await expect.poll(() => done, { message }).toBe(true)
  return value as T
}

/** The session ID of an ACP request, or undefined. */
export const sessionIdOf = (message: AcpMessage) => (message.params as { sessionId?: unknown } | undefined)?.sessionId

/** The `cwd` of an ACP request, or undefined. */
export const cwdOf = (message: AcpMessage) => (message.params as { cwd?: unknown } | undefined)?.cwd

/** The messages of one agent process. */
export const ofProcess = (messages: ProcessMessage[], pid: number) => messages.filter((entry) => entry.pid === pid)

/** Compares two paths on Windows: case, separators and a trailing separator do not count. */
export const samePath = (a: unknown, b: string) => {
  if (typeof a !== 'string') return false
  const clean = (path: string) => path.replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase()
  return clean(a) === clean(b)
}

/** The value of an environment variable, with the name in any case, as Windows reads it. */
export function variable(env: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(env).find((key) => key.toUpperCase() === name.toUpperCase())
  return key === undefined ? undefined : env[key]
}

/** Opens "Profile settings" of the profile "Personal", sets its Claude folder, and saves. */
export async function setClaudeFolder(page: Page, folder: string, check: string): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^${PROFILE}`) }).first().click()
  const menu = page.getByRole('group', { name: 'Profiles' })
  await expect(menu, `${check}: the profile menu "Profiles" does not open.`).toBeVisible()
  await menu.getByRole('button', { name: 'Profile settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Profile settings' })
  await expect(dialog, `${check}: the dialog "Profile settings" does not open.`).toBeVisible()
  const field = dialog.getByRole('textbox', { name: 'Claude folder', exact: true })
  await expect(field, `${check}: the dialog "Profile settings" has no text field "Claude folder".`).toBeEditable()
  await field.fill(folder)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog, `${check}: the dialog "Profile settings" stays open after "Save".`).toBeHidden()
}
