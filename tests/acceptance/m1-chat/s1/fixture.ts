// The fixture of the A19 tests: the built app, in a temporary data folder, with an old profile.
//
// The old profile is a `workspace.json` of version 4, as Aether wrote it before decision 0005.
// It has one project, one work item and one session draft. The fixture writes it as plain JSON
// and imports no product type, so the removal of the project types does not break this file.
//
// How the app finds the temporary folder: the app keeps its data in Electron's `userData`
// folder. The fixture passes the standard Chromium switch `--user-data-dir`, as the fixture of
// m0-gates S5 did. The app process also gets a changed `APPDATA`. This is only a partial guard.
// The check of the real folder at the end is the proof.
//
// From m1-chat S2, the first start with old files imports each account as a profile, and a
// dialog asks for the workspace directory of each profile (flow 1). The fixture answers that
// dialog before each test, with the UI of the S2 tests: the dialog "Choose workspace
// directories", the field "Workspace directory of Personal" and the button "Save directories".
// The dialog must show. A wait "if it shows" would race with the start of the app.
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { _electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test'

const ROOT = resolve(__dirname, '../../../..')

export const PROJECT_NAME = 'Old demo project'
export const ITEM_TITLE = 'Old work item to say hello'
export const SESSION_TITLE = 'Old session draft'

export interface AetherApp {
  app: ElectronApplication
  page: Page
  /** The temporary folder that holds everything of this test. */
  root: string
  /** The data folder of the app (`userData`), inside `root`. */
  dataDir: string
}

/** The real data folder of the person who runs the test. The tests must not touch it. */
function realDataDir(): string {
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
  // The files that Aether writes. Chromium caches and logs are not part of the check.
  for (const name of ['agents.json', 'workspace.json', 'runs', 'aether.db']) await visit(join(folder, name))
  return found
}

/** An old profile: one account with one project, one work item and one session draft. */
function oldProfile(projectDir: string): unknown {
  const at = '2026-01-01T00:00:00.000Z'
  return {
    version: 4,
    accounts: [{ id: 'personal', label: 'Personal', github: null }],
    currentAccountId: 'personal',
    projects: [{ id: 'project-1', accountId: 'personal', name: PROJECT_NAME, path: projectDir, createdAt: at }],
    workItems: [
      {
        id: 'work-item-1',
        projectId: 'project-1',
        title: ITEM_TITLE,
        description: '',
        stage: 'spec',
        history: [{ stage: 'spec', at }],
        createdAt: at
      }
    ],
    sessions: [
      {
        id: 'session-1',
        accountId: 'personal',
        title: SESSION_TITLE,
        prompt: SESSION_TITLE,
        settings: {
          folder: projectDir,
          mode: 'interactive',
          permissions: 'ask',
          model: 'default',
          checkout: 'folder',
          attachments: []
        },
        createdAt: at
      }
    ]
  }
}

/** Answers the import dialog of m1-chat S2: the workspace directory of the one profile, then "Save directories". */
async function answerDirectoryDialog(page: Page, directory: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Choose workspace directories' })
  await expect(
    dialog,
    'No dialog "Choose workspace directories" asks for the workspace directory of the imported profile.'
  ).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Workspace directory of Personal', exact: true }).fill(directory)
  await dialog.getByRole('button', { name: 'Save directories', exact: true }).click()
  await expect(dialog).toBeHidden()
}

/** The environment of the app process: the real one, without the variables that change the app. */
function appEnvironment(root: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) env[name] = value
  }
  // These would run the app as plain Node, load a dev server, or move the data folder.
  for (const name of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_RENDERER_URL', 'AETHER_DATA_DIR']) delete env[name]
  env.APPDATA = join(root, 'appdata')
  return env
}

export const test = base.extend<{ aether: AetherApp }>({
  // Playwright needs the destructured first argument, even when it is empty.
  aether: async ({}, use, testInfo) => {
    const root = await mkdtemp(join(tmpdir(), 'aether-acceptance-'))
    const dataDir = join(root, 'data')
    const projectDir = join(root, 'project')
    await mkdir(dataDir, { recursive: true })
    await mkdir(projectDir, { recursive: true })
    await mkdir(join(root, 'appdata'), { recursive: true })

    // The real folder before the app starts. The check at the end covers the start and the exit.
    const realBefore = await snapshot(realDataDir())

    await writeFile(join(dataDir, 'workspace.json'), JSON.stringify(oldProfile(projectDir), null, 2))

    const app = await _electron.launch({
      args: [ROOT, `--user-data-dir=${dataDir}`],
      cwd: ROOT,
      env: appEnvironment(root)
    })
    const page = await app.firstWindow()
    await app.context().tracing.start({ screenshots: true, snapshots: true })

    try {
      await answerDirectoryDialog(page, projectDir)
      await use({ app, page, root, dataDir })
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
