// The fixture of the S3 tests of milestone m1-chat: A13, A14, and the session slices of the plan.
//
// It reuses the app fixture of S2 (`../s2/fixture.ts`): the built app in a temporary data folder,
// a restart on the same folder, a copy of the database, and the check of the real data folder
// (`%APPDATA%\aether`). All data is fake.
//
// The tests seed the profiles and their sessions through the old `workspace.json`, as the S2
// tests do. Each draft has its own creation time, so "the last session" is a fact of the data.
//
// The UI that these tests expect (S3 test contract). The S1 and S2 contracts stay.
// - The main region: role `main`. The sidebar: `navigation` "Main". A session shows in the sidebar
//   as a button with the exact title of the session. The open session has `aria-current="page"`.
// - "New session": the button "New session" of the sidebar opens the composer of a new session.
// - The composer: the text field "Prompt" and the button "Start session". The title of a new
//   session is the first line of its prompt. The composer of a new session starts with the
//   folder of the last session, as now.
// - The profile menu of S2: the first button whose name starts with the name of the current
//   profile opens the `group` "Profiles".
// - The Mode control: one button named exactly "Mode". Its text is the label of the current mode.
//   It opens a `group` named exactly "Mode" with exactly five buttons, in this order: Ask,
//   Accept edits, Plan, Auto, Approve all. The name of each button starts with its label. The
//   current mode has `aria-pressed="true"`.
// - No control and no text "Tool permissions" exists.
// - Worktree: a disabled button whose name starts with "Worktree" and contains "coming soon".
// - The session attachment: the button "Add context" opens the `group` "Add context". It has a
//   disabled button whose name starts with "Session" and contains "coming soon".
// - The session window: the heading is the title. A draft has the text field "Prompt" with its
//   prompt, and the Mode control with its mode.
// - Delete: the session window has the button "Delete session". It opens a `dialog` whose name
//   starts with "Delete". The dialog has the buttons "Cancel" and "Delete session".
//
// From m1-chat S4, "Start session" starts an agent. The fixture registers the simulated agent in
// `agents.json` of the temporary data folder, under the id `claude-code`, so that Claude Code
// runs the simulated agent and never the real one. The agent replies with its default scenario.
// The tests do not check the reply. Coordinator decision, 2026-11-26: the meaning of each test stays.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { ControlServer } from '../../../simulated-agent/control'
import { answerDirectoryDialog, expect, test as appTest, type AetherApp, type Mode } from '../s2/fixture'

export { answerDirectoryDialog, expect, holds, holdsPath, modesOf, readFiles } from '../s2/fixture'
export type { AetherApp, Mode, Row, SavedData } from '../s2/fixture'

/** The app fixture of S2, with the simulated agent as Claude Code in `agents.json` before the first start. */
export const test = appTest.extend<{ aether: AetherApp }>({
  aether: async ({ aether }, use) => {
    const control = await ControlServer.start()
    const { command, args } = control.agent
    await writeFile(
      join(aether.dataDir, 'agents.json'),
      JSON.stringify({ agents: [{ id: 'claude-code', name: 'Claude Code', command, args }] }, null, 2)
    )
    try {
      await use(aether)
    } finally {
      // Stop the app before the control server, so that no agent loses its pipe while the app runs.
      await aether.stop()
      await control.close()
    }
  }
})

/** The label of each mode, in the order of the Mode control (brief, approach). */
export const MODE_LABELS: Record<Mode, string> = {
  ask: 'Ask',
  'accept-edits': 'Accept edits',
  plan: 'Plan',
  auto: 'Auto',
  'approve-all': 'Approve all'
}
export const MODE_ORDER: Mode[] = ['ask', 'accept-edits', 'plan', 'auto', 'approve-all']

/** The two profiles of the old file. */
export const PROFILES = { personal: 'Personal', client: 'Client Example' } as const
export type Account = keyof typeof PROFILES

/** One session draft of the old file. */
export interface Draft {
  prompt: string
  account: Account
  /** The mode that the draft gets from the import order. The import cannot give accept-edits. */
  mode: Exclude<Mode, 'accept-edits'>
  /** The creation time, as the old file stores it. */
  createdAt: string
}

/** The old settings that give each mode in the import order of the brief. */
const OLD_SETTINGS: Record<Draft['mode'], { mode: string; permissions: string }> = {
  ask: { mode: 'interactive', permissions: 'ask' },
  plan: { mode: 'plan', permissions: 'ask' },
  auto: { mode: 'autopilot', permissions: 'ask' },
  'approve-all': { mode: 'interactive', permissions: 'all' }
}

/** The workspace directory of a profile, inside the temporary folder of the test. */
export const directoryOf = (aether: AetherApp, account: Account) => join(aether.root, 'directories', account)

/** The folder of each draft: a plain folder (not a Git repository) in the workspace directory. */
export const folderOf = (aether: AetherApp, account: Account) => join(directoryOf(aether, account), 'repo-a')

/**
 * Writes the old `workspace.json` of version 4: the two profiles, and the drafts in the given
 * order. The order of the file is not the order of the creation times.
 */
export async function writeOldProfile(aether: AetherApp, drafts: Draft[]): Promise<void> {
  for (const account of Object.keys(PROFILES) as Account[]) {
    await mkdir(folderOf(aether, account), { recursive: true })
  }
  const profile = {
    version: 4,
    accounts: [
      { id: 'personal', label: PROFILES.personal, github: null },
      { id: 'client', label: PROFILES.client, github: null }
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
        folder: folderOf(aether, draft.account),
        ...OLD_SETTINGS[draft.mode],
        model: 'default',
        checkout: 'folder',
        attachments: []
      },
      createdAt: draft.createdAt
    }))
  }
  await writeFile(join(aether.dataDir, 'workspace.json'), JSON.stringify(profile, null, 2))
}

/** Starts the app on the old file and answers the import dialog of flow 1. */
export async function startImported(aether: AetherApp): Promise<Page> {
  const page = await aether.start()
  await answerDirectoryDialog(page, {
    [PROFILES.personal]: directoryOf(aether, 'personal'),
    [PROFILES.client]: directoryOf(aether, 'client')
  })
  return page
}

export const main = (page: Page) => page.getByRole('main')
export const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Main' })
export const sessionEntry = (page: Page, title: string) =>
  sidebar(page).getByRole('button', { name: title, exact: true })

/** The Mode control of the composer or of the session window. */
export const modeControl = (page: Page) => main(page).getByRole('button', { name: 'Mode', exact: true })

/** The menu of the Mode control. */
export const modeMenu = (page: Page) => page.getByRole('group', { name: 'Mode', exact: true })

/** A name that starts with the label, as a whole word. The note of an option can follow. */
export const startsWith = (label: string) => new RegExp(`^${label.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`)

/** Checks that the Mode control shows the mode. */
export async function expectMode(page: Page, mode: Mode, message: string): Promise<void> {
  const control = modeControl(page)
  await expect(control, `${message} No button "Mode" exists.`).toBeVisible()
  await expect(control, message).toHaveText(MODE_LABELS[mode])
}

/** Chooses a mode with the Mode control. */
export async function chooseMode(page: Page, mode: Mode, check: string): Promise<void> {
  const control = modeControl(page)
  await expect(control, `${check}: no button "Mode" exists.`).toBeVisible()
  await control.click()
  const menu = modeMenu(page)
  await expect(menu, `${check}: the button "Mode" opens no group "Mode".`).toBeVisible()
  const option = menu.getByRole('button', { name: startsWith(MODE_LABELS[mode]) })
  await expect(option, `${check}: the menu "Mode" has no option "${MODE_LABELS[mode]}".`).toBeVisible()
  await option.click()
  await expect(menu).toBeHidden()
  await expect(control, `${check}: the button "Mode" does not show the chosen mode.`).toHaveText(MODE_LABELS[mode])
}

/**
 * Opens the composer of a new session with the row "New" of the sidebar (the New page). From S11
 * (user decision, 2026-11-28), the "+" of "Sessions" opens a menu, so the helper uses the row "New".
 */
export async function openNewSession(page: Page): Promise<void> {
  const row = sidebar(page).getByRole('button', { name: 'New', exact: true })
  await expect(row, 'The sidebar has no row "New".').toBeVisible()
  await row.click()
  await expect(row, 'The row "New" does not open the New page.').toHaveAttribute('aria-current', 'page')
  await expect(main(page).getByRole('textbox', { name: 'Prompt', exact: true })).toBeVisible()
  await expect(main(page).getByRole('button', { name: 'Start session', exact: true })).toBeVisible()
}

/** Writes the prompt in the composer of a new session and starts the session. */
export async function startSession(page: Page, prompt: string, check: string): Promise<void> {
  await main(page).getByRole('textbox', { name: 'Prompt', exact: true }).fill(prompt)
  const start = main(page).getByRole('button', { name: 'Start session', exact: true })
  await expect(start, `${check}: the button "Start session" is disabled, so the user cannot create a session.`).toBeEnabled()
  await start.click()
  const title = prompt.split(/\r?\n/)[0]!.trim()
  await expect(sessionEntry(page, title), `${check}: the sidebar does not list the new session "${title}".`).toBeVisible()
  await expect(sessionEntry(page, title), `${check}: the new session "${title}" does not open.`).toHaveAttribute(
    'aria-current',
    'page'
  )
}

/** Switches to a profile through the profile menu of S2. */
export async function switchProfile(page: Page, from: string, to: string): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`^${from}`) }).first().click()
  const menu = page.getByRole('group', { name: 'Profiles' })
  await expect(menu, 'The profile menu "Profiles" does not open.').toBeVisible()
  await menu.getByRole('button', { name: to, exact: true }).click()
  await expect(page.getByRole('button', { name: new RegExp(`^${to}`) }).first()).toBeVisible()
}
