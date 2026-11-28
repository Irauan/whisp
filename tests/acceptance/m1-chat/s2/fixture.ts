// The fixture of the A17 and A18 tests of milestone m1-chat: the built app, in a temporary data
// folder that a test fills with old files first. A test can stop and start the app again on the
// same data folder. The product has no test hook.
//
// - The app finds the temporary folder through the Chromium switch `--user-data-dir`, as in S1.
// - All data is fake. Each test also checks that the app did not change the real data folder
//   (`%APPDATA%\aether`).
// - A test reads the database `aether.db` of the data folder with `node:sqlite`, after the app
//   stops. It reads a copy, so the read cannot change the file of the app.
//
// The UI that these tests expect (S2 test contract):
// Terms (user decision, 2026-11-26): each old account becomes a profile. The workspace directory
// of a profile is the folder that holds its repositories.
// - The import dialog: role `dialog`, name "Choose workspace directories". It has one text
//   field per imported profile, named "Workspace directory of <profile name>", and a button
//   "Save directories".
// - The profile menu: the switcher button shows the name of the current profile. Its menu is a
//   `group` named "Profiles", with one button per profile, named by the profile.
// - The profile settings: the menu has a button "Profile settings". It opens a `dialog` named
//   "Profile settings" for the current profile. The dialog has a text field "Name" with the
//   name of the profile, a text field "Workspace directory" with its workspace directory, the
//   GitHub account of the profile as the text "@<login>", a button "Save" that saves and
//   closes it, and a button "Cancel" that closes it.
// - The messages of A18: an element with role `alert`.
import { copyFile, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { windowArgs } from '../../support/windows'

const ROOT = resolve(__dirname, '../../../..')

/** The name of the database in the data folder. */
export const DATABASE = 'aether.db'

/** The five modes of a session, as S2 stores them (see `docs/milestones/m1-chat/plan.md`). */
export const MODES = ['ask', 'accept-edits', 'plan', 'auto', 'approve-all'] as const
export type Mode = (typeof MODES)[number]

export const DIRECTORY_DIALOG = 'Choose workspace directories'
export const SAVE_DIRECTORIES = 'Save directories'
export const directoryField = (profile: string) => `Workspace directory of ${profile}`

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

/** Each file under the given paths of a folder, with its content. A missing path adds nothing. */
export async function readFiles(folder: string, paths: string[]): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>()
  const visit = async (path: string): Promise<void> => {
    let info
    try {
      info = await stat(path)
    } catch {
      return
    }
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await visit(join(path, name))
    } else {
      files.set(relative(folder, path), await readFile(path))
    }
  }
  for (const path of paths) await visit(join(folder, path))
  return files
}

/** The files of a folder, at any depth, that hold exactly these bytes. */
export async function filesWithContent(folder: string, content: Buffer): Promise<string[]> {
  const found: string[] = []
  const visit = async (path: string): Promise<void> => {
    let info
    try {
      info = await stat(path)
    } catch {
      return
    }
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await visit(join(path, name))
    } else if (info.size === content.length && (await readFile(path)).equals(content)) {
      found.push(relative(folder, path))
    }
  }
  await visit(folder)
  return found
}

/** One row of a table of the database. */
export interface Row {
  table: string
  values: Record<string, unknown>
}

/** Each value of a row: the columns, and each value inside a column that holds JSON. */
function* valuesOf(row: Row): Generator<{ key: string; value: unknown }> {
  const walk = function* (key: string, value: unknown): Generator<{ key: string; value: unknown }> {
    yield { key, value }
    if (typeof value === 'string' && /^\s*[[{]/.test(value)) {
      let parsed: unknown
      try {
        parsed = JSON.parse(value)
      } catch {
        return
      }
      yield* walk(key, parsed)
    } else if (Array.isArray(value)) {
      for (const item of value) yield* walk(key, item)
    } else if (typeof value === 'object' && value !== null) {
      for (const [inner, item] of Object.entries(value)) yield* walk(inner, item)
    }
  }
  for (const [key, value] of Object.entries(row.values)) yield* walk(key, value)
}

/** Compares two paths on Windows: case, separators and a trailing separator do not count. */
const samePath = (a: string, b: string) => {
  const clean = (path: string) => path.replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase()
  return clean(a) === clean(b)
}

/** True when the row holds this text, in a column or inside a column that holds JSON. */
export function holds(row: Row, text: string): boolean {
  for (const { value } of valuesOf(row)) if (value === text) return true
  return false
}

/** True when the row holds this path, in a column or inside a column that holds JSON. */
export function holdsPath(row: Row, path: string): boolean {
  for (const { value } of valuesOf(row)) if (typeof value === 'string' && samePath(value, path)) return true
  return false
}

/** The session modes of a row: the values of a column `mode`, or of a JSON key `mode`, that are one of the five modes. */
export function modesOf(row: Row): Mode[] {
  const found = new Set<Mode>()
  for (const { key, value } of valuesOf(row)) {
    if (key === 'mode' && typeof value === 'string' && (MODES as readonly string[]).includes(value)) {
      found.add(value as Mode)
    }
  }
  return [...found]
}

/** The saved data: each row of each table of the database. */
export class SavedData {
  constructor(readonly rows: Row[]) {}

  rowsOf(table: string): Row[] {
    return this.rows.filter((row) => row.table === table)
  }

  /** The rows that hold this text. */
  holding(text: string): Row[] {
    return this.rows.filter((row) => holds(row, text))
  }

  /** The session rows of a draft: rows that hold its prompt and a session mode. */
  sessionsWithPrompt(prompt: string): Row[] {
    return this.holding(prompt).filter((row) => modesOf(row).length > 0)
  }

  describe(): string {
    const tables = [...new Set(this.rows.map((row) => row.table))]
    return tables.map((table) => `${table}: ${JSON.stringify(this.rowsOf(table).map((row) => row.values))}`).join('\n')
  }
}

export interface AetherApp {
  /** The temporary folder that holds everything of this test. */
  root: string
  /** The data folder of the app (`userData`), inside `root`. */
  dataDir: string
  /** Starts the app on the data folder and returns its window. */
  start(): Promise<Page>
  /** Closes the app. Its files are then complete. */
  stop(): Promise<void>
  /** Reads a copy of the database. Call it after `stop`. */
  readDatabase(): Promise<SavedData>
}

export const test = base.extend<{ aether: AetherApp }>({
  // Playwright needs the destructured first argument, even when it is empty.
  aether: async ({}, use, testInfo) => {
    // The long form of the path: a short 8.3 name of the temporary folder must not reach the app.
    const root = await realpath(await mkdtemp(join(tmpdir(), 'aether-acceptance-')))
    const dataDir = join(root, 'data')
    await mkdir(dataDir, { recursive: true })
    await mkdir(join(root, 'appdata'), { recursive: true })

    // The real folder before the app starts. The check at the end covers each start and exit.
    const realBefore = await snapshot(realDataDir())

    let app: ElectronApplication | null = null
    let starts = 0
    const stop = async () => {
      if (!app) return
      const running = app
      app = null
      const failed = testInfo.status !== testInfo.expectedStatus
      await running
        .context()
        .tracing.stop(failed ? { path: testInfo.outputPath(`trace-${starts}.zip`) } : {})
        .catch(() => undefined)
      await running.close().catch(() => undefined)
    }

    const aether: AetherApp = {
      root,
      dataDir,
      start: async () => {
        if (app) throw new Error('The app runs already. Stop it first.')
        starts += 1
        app = await _electron.launch({
          args: windowArgs([ROOT, `--user-data-dir=${dataDir}`]),
          cwd: ROOT,
          env: appEnvironment(root)
        })
        const page = await app.firstWindow()
        await app.context().tracing.start({ screenshots: true, snapshots: true })
        return page
      },
      stop,
      readDatabase: async () => {
        if (app) throw new Error('Stop the app before you read its database.')
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
            for (const values of database.prepare(`SELECT * FROM ${quoted}`).all()) {
              rows.push({ table, values: { ...values } })
            }
          }
          return new SavedData(rows)
        } finally {
          database.close()
        }
      }
    }

    try {
      await use(aether)
    } finally {
      await stop()
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined)
      // The app is gone. The real folder must have the same files, with the same times.
      expect(await snapshot(realDataDir()), 'The app changed the real user data folder.').toEqual(realBefore)
    }
  }
})

/**
 * Answers the import dialog of flow 1: one workspace directory for each profile, then
 * "Save directories".
 * The dialog must show. A wait "if it shows" would race with the start of the app.
 */
export async function answerDirectoryDialog(page: Page, directories: Record<string, string>): Promise<void> {
  const dialog = page.getByRole('dialog', { name: DIRECTORY_DIALOG })
  await expect(
    dialog,
    `A17 (flow 1): no dialog "${DIRECTORY_DIALOG}" asks for the workspace directory of each profile.`
  ).toBeVisible()
  for (const [profile, path] of Object.entries(directories)) {
    await dialog.getByRole('textbox', { name: directoryField(profile), exact: true }).fill(path)
  }
  await dialog.getByRole('button', { name: SAVE_DIRECTORIES, exact: true }).click()
  await expect(dialog, `The dialog "${DIRECTORY_DIALOG}" stays open after "${SAVE_DIRECTORIES}".`).toBeHidden()
}

export { expect }
