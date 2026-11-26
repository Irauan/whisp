// The fixture of the acceptance tests: the built app, in a temporary data folder, with the
// simulated agent registered in `agents.json`. The product has no test hook.
//
// How the app finds the temporary folder: the app keeps its data in Electron's `userData`
// folder. On Windows, Electron takes the roaming profile from the system, not from the
// `APPDATA` variable, so `APPDATA` alone does not move it. Checked on Windows 11 with Electron 45.
// The fixture passes the standard Chromium switch `--user-data-dir` instead. The tests prove
// that it works: they read `userData` from the running app.
// The app process also gets a changed `APPDATA`. This is only a partial guard: `USERPROFILE`,
// `LOCALAPPDATA` and the known-folder API of Windows still lead a child program to the real
// profile. The check of the real folder below is the proof, not this variable.
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { _electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test'
import type { Workspace } from '../../../../src/shared/model'
import { ControlServer } from '../../../simulated-agent/control'

const ROOT = resolve(__dirname, '../../../..')

export const ITEM_ID = 'work-item-1'
export const ITEM_TITLE = 'Say hello to the agent'
export const PROJECT_NAME = 'Demo project'

export interface AetherApp {
  app: ElectronApplication
  page: Page
  control: ControlServer
  /** The temporary folder that holds everything of this test. */
  root: string
  /** The data folder of the app (`userData`), inside `root`. */
  dataDir: string
  /** The folder of the project, where the agent works. */
  projectDir: string
}

/** The real data folder of the person who runs the test. The tests must not touch it. */
export function realDataDir(): string {
  const roaming = process.env.APPDATA
  if (!roaming) throw new Error('APPDATA is not set in the test process.')
  return join(roaming, 'aether')
}

/** Lists the files and folders of the user data that the product writes, with their times. */
export async function snapshot(folder: string): Promise<string[]> {
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
  for (const name of ['agents.json', 'workspace.json', 'runs']) await visit(join(folder, name))
  return found
}

function workspace(projectDir: string): Workspace {
  const at = '2026-01-01T00:00:00.000Z'
  return {
    version: 4,
    accounts: [{ id: 'personal', label: 'Personal', github: null }],
    currentAccountId: 'personal',
    projects: [{ id: 'project-1', accountId: 'personal', name: PROJECT_NAME, path: projectDir, createdAt: at }],
    workItems: [
      {
        id: ITEM_ID,
        projectId: 'project-1',
        title: ITEM_TITLE,
        description: '',
        stage: 'spec',
        history: [{ stage: 'spec', at }],
        createdAt: at
      }
    ],
    sessions: []
  }
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

    const control = await ControlServer.start()
    const { command, args } = control.agent
    await writeFile(
      join(dataDir, 'agents.json'),
      JSON.stringify({ agents: [{ id: 'simulated', name: 'Simulated', command, args }] }, null, 2)
    )
    await writeFile(join(dataDir, 'workspace.json'), JSON.stringify(workspace(projectDir), null, 2))

    const app = await _electron.launch({
      args: [ROOT, `--user-data-dir=${dataDir}`],
      cwd: ROOT,
      env: appEnvironment(root)
    })
    const page = await app.firstWindow()
    await app.context().tracing.start({ screenshots: true, snapshots: true })

    try {
      await use({ app, page, control, root, dataDir, projectDir })
    } finally {
      const failed = testInfo.status !== testInfo.expectedStatus
      await app
        .context()
        .tracing.stop(failed ? { path: testInfo.outputPath('trace.zip') } : {})
        .catch(() => undefined)
      await app.close().catch(() => undefined)
      await control.close()
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined)
      // The app is gone. The real folder must have the same files, with the same times.
      expect(await snapshot(realDataDir()), 'The app changed the real user data folder.').toEqual(realBefore)
    }
  }
})

export { expect }
