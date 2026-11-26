// A17 of milestone m1-chat, on the built app, with flow 1 of the brief.
//
// A17: a profile with `workspace.json` (2 accounts, 3 session drafts) and `runs/`. After the
// first start after the upgrade, 2 workspaces and 3 sessions exist. Each draft has the mode
// from the import order. The old files are unchanged.
// Flow 1: Aether imports each account as a workspace. A dialog asks for the root of each one.
//
// The import order of the brief maps the old settings of a draft to a mode:
//   Plan -> plan, Autopilot -> auto, Approve all -> approve-all, Assisted -> auto, else -> ask.
// The old mode is one of interactive, plan, autopilot. The old permissions are one of ask,
// assisted, all. The drafts of the two profiles below cover each branch, and the order of the
// branches: a draft that matches two branches gets the mode of the first.
//
// The tests read the mode from the database, because S2 shows no mode. S3 shows it.
// No test sleeps. Each wait is an auto-waiting check of Playwright.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import {
  answerRootDialog,
  expect,
  holdsPath,
  modesOf,
  readFiles,
  ROOT_DIALOG,
  rootField,
  SAVE_ROOTS,
  test,
  type AetherApp,
  type Mode,
  type SavedData
} from './fixture'

interface Draft {
  prompt: string
  account: 'personal' | 'client'
  mode: 'interactive' | 'plan' | 'autopilot'
  permissions: 'ask' | 'assisted' | 'all'
  /** The mode that the import order gives. */
  expected: Mode
}

const WORKSPACES = { personal: 'Personal', client: 'Client Example' } as const

/** The drafts of A17. Each one has Approve all, so only the order picks Plan or Auto first. */
const DRAFTS: Draft[] = [
  // Plan comes before Approve all.
  { prompt: 'Write the release notes', account: 'personal', mode: 'plan', permissions: 'all', expected: 'plan' },
  // Autopilot comes before Approve all.
  { prompt: 'Fix the login page', account: 'personal', mode: 'autopilot', permissions: 'all', expected: 'auto' },
  // Approve all, with no Plan and no Autopilot.
  { prompt: 'Review the invoice export', account: 'client', mode: 'interactive', permissions: 'all', expected: 'approve-all' }
]

/** The other drafts: Assisted, the else branch, and Plan before Assisted. */
const OTHER_DRAFTS: Draft[] = [
  { prompt: 'Sort the inbox', account: 'personal', mode: 'interactive', permissions: 'assisted', expected: 'auto' },
  { prompt: 'Rename the old files', account: 'personal', mode: 'interactive', permissions: 'ask', expected: 'ask' },
  { prompt: 'Count the open issues', account: 'client', mode: 'plan', permissions: 'assisted', expected: 'plan' }
]

/** The roots that the user chooses in the import dialog. */
const rootsOf = (aether: AetherApp) => ({
  [WORKSPACES.personal]: join(aether.root, 'roots', 'personal'),
  [WORKSPACES.client]: join(aether.root, 'roots', 'client')
})

/**
 * Writes an old profile: `workspace.json` of version 4 with 2 accounts and the drafts, and a
 * `runs/` folder with one conversation file and one unreadable conversation file.
 *
 * The app writes `workspace.json` as JSON with 2 spaces and LF. This file is compact JSON with
 * CRLF and a final line end, so a rewrite of the file by the app shows as a change.
 */
async function writeOldProfile(aether: AetherApp, drafts: Draft[]): Promise<void> {
  const roots = rootsOf(aether)
  const at = '2026-01-01T00:00:00.000Z'
  const folderOf = (draft: Draft) => join(roots[WORKSPACES[draft.account]], 'repo-a')
  for (const root of Object.values(roots)) await mkdir(join(root, 'repo-a'), { recursive: true })

  const profile = {
    version: 4,
    accounts: [
      { id: 'personal', label: WORKSPACES.personal, github: null },
      {
        id: 'client',
        label: WORKSPACES.client,
        github: { login: 'example-user-one', name: 'Example User One', avatar: null }
      }
    ],
    currentAccountId: 'personal',
    projects: [],
    workItems: [],
    sessions: drafts.map((draft, index) => ({
      id: `session-${index + 1}`,
      accountId: draft.account,
      title: draft.prompt,
      prompt: draft.prompt,
      settings: {
        folder: folderOf(draft),
        mode: draft.mode,
        permissions: draft.permissions,
        model: 'default',
        checkout: 'folder',
        attachments: []
      },
      createdAt: at
    }))
  }
  const lines = JSON.stringify(profile).replace(/,"sessions":/, ',\r\n"sessions":')
  await writeFile(join(aether.dataDir, 'workspace.json'), `${lines}\r\n`)

  // The conversation files of the old work items. One of them is unreadable.
  const runs = join(aether.dataDir, 'runs')
  await mkdir(runs, { recursive: true })
  const run = {
    itemId: 'work-item-1',
    agentId: null,
    sessionId: null,
    status: 'idle',
    entries: [{ kind: 'user', text: 'An old message' }],
    question: null
  }
  await writeFile(join(runs, 'work-item-1.json'), `${JSON.stringify(run)}\r\n`)
  await writeFile(join(runs, 'work-item-2.json'), '{"itemId":"work-item-2","entries":[\r\n')
}

const OLD_FILES = ['workspace.json', 'runs']

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Main' })

/** Switches to a workspace through the workspace menu. */
async function switchWorkspace(page: Page, from: string, to: string): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^${from}`) }).first().click()
  const menu = page.getByRole('group', { name: 'Workspaces' })
  await expect(menu, 'The workspace menu "Workspaces" does not open.').toBeVisible()
  await menu.getByRole('button', { name: to, exact: true }).click()
}

/** Opens the settings of the current workspace through the workspace menu, and checks its name. */
async function openSettings(page: Page, current: string) {
  await page.getByRole('button', { name: new RegExp(`^${current}`) }).first().click()
  const menu = page.getByRole('group', { name: 'Workspaces' })
  await expect(menu, 'The workspace menu "Workspaces" does not open.').toBeVisible()
  await menu.getByRole('button', { name: 'Workspace settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Workspace settings' })
  await expect(dialog, `The dialog "Workspace settings" of ${current} does not open.`).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(current)
  return dialog
}

/** Checks that the sidebar lists the drafts of one workspace, and no draft of the other. */
async function sidebarShows(page: Page, drafts: Draft[], account: Draft['account']): Promise<void> {
  for (const draft of drafts) {
    const item = sidebar(page).getByText(draft.prompt, { exact: true })
    if (draft.account === account) {
      await expect(item, `The sidebar of ${WORKSPACES[account]} does not list its draft "${draft.prompt}".`).toBeVisible()
    } else {
      await expect(item, `The sidebar of ${WORKSPACES[account]} lists "${draft.prompt}" of another workspace.`).toHaveCount(0)
    }
  }
}

/** Checks the saved data: 2 workspaces, and one session per draft with the mode of the import order. */
function expectImported(data: SavedData, drafts: Draft[]): void {
  const dump = `The database holds:\n${data.describe()}`

  // 2 workspaces: one row per account name, in one table with 2 rows.
  const workspaceRows = Object.values(WORKSPACES).map((name) => {
    const rows = data.holding(name)
    expect(rows, `A17: the database must hold one workspace "${name}".\n${dump}`).toHaveLength(1)
    return rows[0]!
  })
  const workspaceTable = workspaceRows[0]!.table
  expect(workspaceRows.map((row) => row.table), `A17: the workspaces must be in one table.\n${dump}`).toEqual([
    workspaceTable,
    workspaceTable
  ])
  expect(data.rowsOf(workspaceTable), `A17: exactly 2 workspaces must exist.\n${dump}`).toHaveLength(2)

  // 3 sessions: one row per draft, with its prompt and its mode, in one table with 3 rows.
  const sessionRows = drafts.map((draft) => {
    const rows = data.sessionsWithPrompt(draft.prompt)
    expect(rows, `A17: the database must hold one session with the prompt "${draft.prompt}" and a mode.\n${dump}`).toHaveLength(1)
    return { draft, row: rows[0]! }
  })
  const sessionTable = sessionRows[0]!.row.table
  for (const { row } of sessionRows) {
    expect(row.table, `A17: the sessions must be in one table.\n${dump}`).toBe(sessionTable)
  }
  expect(data.rowsOf(sessionTable), `A17: exactly 3 sessions must exist.\n${dump}`).toHaveLength(3)

  // Each draft has the mode from the import order.
  for (const { draft, row } of sessionRows) {
    expect(
      { prompt: draft.prompt, modes: modesOf(row) },
      `A17: the draft with mode ${draft.mode} and permissions ${draft.permissions} must have the mode ${draft.expected}.`
    ).toEqual({ prompt: draft.prompt, modes: [draft.expected] })
  }
}

test.describe('A17: the first start imports the old profile', () => {
  test('A17 (flow 1): the first start shows a dialog that asks for the root of each workspace, and saves the roots', async ({
    aether
  }) => {
    await writeOldProfile(aether, DRAFTS)
    const roots = rootsOf(aether)
    const page = await aether.start()

    const dialog = page.getByRole('dialog', { name: ROOT_DIALOG })
    await expect(dialog, `A17 (flow 1): no dialog "${ROOT_DIALOG}" asks for the root of each workspace.`).toBeVisible()
    // One root field for each imported workspace, named by the workspace.
    await expect(dialog.getByRole('textbox', { name: /^Root of / })).toHaveCount(2)
    for (const [workspace, path] of Object.entries(roots)) {
      const field = dialog.getByRole('textbox', { name: rootField(workspace), exact: true })
      await expect(field, `The dialog has no field "${rootField(workspace)}".`).toBeVisible()
      await field.fill(path)
    }
    await dialog.getByRole('button', { name: SAVE_ROOTS, exact: true }).click()
    await expect(dialog).toBeHidden()

    // Each workspace keeps the root that the user chose.
    await aether.stop()
    const data = await aether.readDatabase()
    for (const [workspace, path] of Object.entries(roots)) {
      const rows = data.holding(workspace)
      expect(rows, `A17: the database must hold one workspace "${workspace}".\n${data.describe()}`).toHaveLength(1)
      expect(
        holdsPath(rows[0]!, path),
        `A17: the workspace "${workspace}" must keep the root ${path}.\n${data.describe()}`
      ).toBe(true)
    }
  })

  test('A17: 2 workspaces and 3 sessions exist, and each draft has the mode of the import order (Plan, Autopilot, Approve all)', async ({
    aether
  }) => {
    await writeOldProfile(aether, DRAFTS)
    const page = await aether.start()
    await answerRootDialog(page, rootsOf(aether))

    // Each workspace owns its sessions: the sidebar lists the drafts of the current workspace only.
    await sidebarShows(page, DRAFTS, 'personal')
    await switchWorkspace(page, WORKSPACES.personal, WORKSPACES.client)
    await sidebarShows(page, DRAFTS, 'client')

    await aether.stop()
    expectImported(await aether.readDatabase(), DRAFTS)
  })

  test('A17: the import order maps Assisted to Auto, the other settings to Ask, and Plan before Assisted', async ({
    aether
  }) => {
    await writeOldProfile(aether, OTHER_DRAFTS)
    const page = await aether.start()
    await answerRootDialog(page, rootsOf(aether))
    await sidebarShows(page, OTHER_DRAFTS, 'personal')

    await aether.stop()
    expectImported(await aether.readDatabase(), OTHER_DRAFTS)
  })

  test('A17: the old workspace.json and runs/ stay byte-equal, and a second start imports nothing again', async ({
    aether
  }) => {
    await writeOldProfile(aether, DRAFTS)
    const before = await readFiles(aether.dataDir, OLD_FILES)
    expect([...before.keys()].sort()).toEqual(['runs\\work-item-1.json', 'runs\\work-item-2.json', 'workspace.json'])

    // The first start, with the answer of the import dialog.
    const page = await aether.start()
    await answerRootDialog(page, rootsOf(aether))
    await sidebarShows(page, DRAFTS, 'personal')
    await aether.stop()
    expect(await readFiles(aether.dataDir, OLD_FILES), 'A17: the first start changed the old files.').toEqual(before)

    // The second start: no import dialog, and the same workspaces and sessions.
    const again = await aether.start()
    await sidebarShows(again, DRAFTS, 'personal')
    // A click proves that no modal dialog blocks the window.
    await switchWorkspace(again, WORKSPACES.personal, WORKSPACES.client)
    await sidebarShows(again, DRAFTS, 'client')
    await expect(again.getByRole('dialog', { name: ROOT_DIALOG }), 'A17: the second start asks for the roots again.').toHaveCount(0)
    await aether.stop()

    expect(await readFiles(aether.dataDir, OLD_FILES), 'A17: the second start changed the old files.').toEqual(before)
    expectImported(await aether.readDatabase(), DRAFTS)
  })

  test('A17: after the import, a switch of the workspace and an edit of its root leave workspace.json and runs/ byte-equal', async ({
    aether
  }) => {
    // Decision 0005: the old files stay unchanged, also after a change of the imported data.
    await writeOldProfile(aether, DRAFTS)
    const before = await readFiles(aether.dataDir, OLD_FILES)
    const roots = rootsOf(aether)
    const edited = join(aether.root, 'roots', 'client-edited')
    await mkdir(edited, { recursive: true })

    const page = await aether.start()
    await answerRootDialog(page, roots)
    await switchWorkspace(page, WORKSPACES.personal, WORKSPACES.client)
    await sidebarShows(page, DRAFTS, 'client')

    // Edit the root of "Client Example" in its settings.
    const settings = await openSettings(page, WORKSPACES.client)
    const root = settings.getByRole('textbox', { name: 'Root', exact: true })
    await expect(root, 'The workspace settings do not show the root that the import dialog saved.').toHaveValue(
      roots[WORKSPACES.client]!
    )
    await root.fill(edited)
    await settings.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(settings).toBeHidden()
    await aether.stop()

    expect(await readFiles(aether.dataDir, OLD_FILES), 'A17: a switch and an edit of a root changed the old files.').toEqual(
      before
    )
    const data = await aether.readDatabase()
    const rows = data.holding(WORKSPACES.client)
    expect(rows, `A17: the database must hold one workspace "${WORKSPACES.client}".\n${data.describe()}`).toHaveLength(1)
    expect(
      holdsPath(rows[0]!, edited),
      `A17: the workspace "${WORKSPACES.client}" must keep the edited root ${edited}.\n${data.describe()}`
    ).toBe(true)
    expect(
      holdsPath(rows[0]!, roots[WORKSPACES.client]!),
      `A17: the workspace "${WORKSPACES.client}" still holds its old root.\n${data.describe()}`
    ).toBe(false)
  })

  test('A17: the GitHub account of an old account carries over to its workspace', async ({ aether }) => {
    await writeOldProfile(aether, DRAFTS)
    const page = await aether.start()
    await answerRootDialog(page, rootsOf(aether))

    // "Personal" had no GitHub account. Its settings do not show the one of "Client Example".
    const personal = await openSettings(page, WORKSPACES.personal)
    await expect(personal.getByText('@example-user-one', { exact: true })).toHaveCount(0)
    await personal.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(personal).toBeHidden()

    // "Client Example" had the GitHub account example-user-one.
    await switchWorkspace(page, WORKSPACES.personal, WORKSPACES.client)
    const client = await openSettings(page, WORKSPACES.client)
    await expect(
      client.getByText('@example-user-one', { exact: true }),
      'A17: the settings of "Client Example" do not show its GitHub account @example-user-one.'
    ).toBeVisible()
  })
})
