// The fixture of the S11 tests of milestone m1-chat: A24, A25, and the acceptance checks of S11
// (spec `docs/milestones/m1-chat/stories/s11-sidebar-status.md`, "Checks", and its mockup
// `s11-sidebar-status.mockup.html`, approved by the user on 2026-11-28).
//
// The setup is the chat fixture of S4 (through the S5 and S8 fixtures): the built app in a temporary
// data folder, a temporary APPDATA and home, the fake `gh`, the simulated agent as Claude Code in
// `agents.json`, and the check that the real data folder (`%APPDATA%\aether`) does not change. The
// profiles and their drafts come from an old `workspace.json`, in plain folders under the workspace
// directory, so Aether asks no trust question (S6). All data is fake. The product has no test hook.
//
// The simulated agent is used as it is (its files are locked). A test gives the steps of a turn with
// the scenario `steps`. A gate holds a turn, so that the test can move the view first. A gate stays
// open for good, so each turn uses its own gate name.
//
// Changes of the test to Electron. None of them is a hook of the product:
// - Focus: the test windows are hidden (user decision, 2026-11-27), so the focus flag of the main
//   process starts false. `setWindowFocus` sends `emit('focus')` or `emit('blur')` to the window
//   through `app.evaluate`, as the spec says. Each test sets the focus that it needs.
// - The folder picker: `stubPickers` of S7 replaces `dialog.showOpenDialog` in the main process.
// - `recordCalls` wraps the handler of the channel `aether:invoke` in the main process, as
//   `holdAnswers` of S5 does, and records the input of each call of one contract (S11-21).
// - `invoke` of S7 calls a contract through the bridge of the renderer, as the UI does.
//
// No test sleeps. A test waits on an auto-waiting check of Playwright, or on a report of the
// simulated agent through `reach`. A check that something does not show first waits for a later
// fact (`settle`: one call through the bridge after the turn ended, then three frames).
//
// The UI that these tests expect (S11 test contract). The S1 to S10 contracts stay.
// - Session row: a button in the `navigation` "Main", whose accessible name is exactly the title of
//   the session (S3 contract, spec "Accessibility"). Its state is its accessible description:
//   exactly "Working", "New answer" or "Needs your answer". The normal state has no description.
// - Status icon: the icon of the state is an `svg` in the row button. The tests read the class that
//   `lucide-react` gives each icon: `lucide-message-square` (the chat icon) and `lucide-hand`.
//   "New answer" colors the chat icon `--unread` (#4493f8); "Needs your answer" colors the hand
//   `--attention` (#d29922). "Working" runs an animation in the row (`getAnimations`), and none with
//   `prefers-reduced-motion: reduce`.
// - Group toggle: one button for each folder, named exactly the folder name, with `aria-expanded`.
//   A click, Enter or Space collapses or expands the group. The session rows of a collapsed group
//   are hidden.
// - Group icons: the test author chose this reading of rules 3 and 7, because the spec gives the
//   icons no accessible contract. The toggle holds the icons `lucide-folder`, `lucide-chevron-right`
//   (collapsed) and `lucide-chevron-down` (expanded). An icon "shows" when it and each element
//   around it have a box, no `display: none`, no `visibility: hidden`, and an opacity above 0.9.
//   With no hover and no focus in the group row, the folder icon shows. On hover or focus, the
//   chevron shows and the folder icon does not.
// - Group "+": a button named exactly "New session in <folder name>". It shows only on hover of the
//   group row or with the focus in it (same reading of "shows" as above). Tab reaches it.
// - Group row: the smallest element that holds the toggle and its "+". The first group row starts 0
//   to 4 px under the "Sessions" row (`.group-head`, spec rule 4). The icon of a session row is
//   28 px (4 px of rounding) right of the folder icon of its group (rule 5).
// - Collapsed group status: the toggle has the accessible description "Needs your answer" or "New
//   answer", and the group row shows the hand or the chat icon in `--unread` (rule 10, open choice 3).
// - Empty folder: the muted text "No sessions yet" shows directly under its group row.
// - The "+" of the "Sessions" heading: the one button of `.group-head`. The spec gives it no name,
//   so the tests do not read one. A click opens the "+" menu.
// - Menus: an element with the role `menu` or `group` (as `Menu.tsx` gives it). Its items are the
//   elements with the role `button` or `menuitem` in it. The text of an item starts with its label.
//   - The "+" menu: it holds the text "Start session in", one item for each folder (with the icon
//     `lucide-folder`), "Add from GitHub" and "Add from URL" (disabled, with the text "Coming soon"),
//     and "Add local folder or repository".
//   - The folder menu: a right click on the group toggle opens it. Its items are "New session" and
//     "Remove folder". "Remove folder" is disabled for a folder with sessions. Escape closes it.
// - Composer folder: the folder button of the composer of a new session is named with the full path
//   of the folder, as today (`SessionComposer.tsx`).
// - Contracts (spec "Interfaces"): `folders.add { profileId, path }`, `sessions.list { profileId }`
//   and `sessions.set-viewing { sessionId | null }`.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, type Locator, type Page } from '@playwright/test'
import { answerDirectoryDialog } from '../s2/fixture'
import { invoke, main, nextFrames, reach, send, sessionEntry, sidebar, transcript, type ChatApp } from '../s5/fixture'

export * from '../s5/fixture'
export { stubPickers } from '../s7/fixture'
export { switchProfile } from '../s3/fixture'

/** The state texts of a session row (spec, "Status icon of a session row"). */
export const STATE = { working: 'Working', unread: 'New answer', attention: 'Needs your answer' } as const

/** The colors of the new tokens (spec, "Screens"): `--unread` and `--attention`, as computed colors. */
export const COLOR = { unread: 'rgb(68, 147, 248)', attention: 'rgb(210, 153, 34)' } as const

export const EMPTY = 'No sessions yet'

const escaped = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
const startsWithLabel = (label: string) => new RegExp(`^\\s*${escaped(label)}`)

// The sidebar.

/** The toggle button of the group of a folder. Relative to the page, so it also works inside `has`. */
const toggleIn = (scope: Page | Locator, name: string) =>
  scope.locator('[aria-expanded]').and(scope.getByRole('button', { name, exact: true }))

export const groupToggle = (page: Page, name: string) => toggleIn(sidebar(page), name)
export const groupPlus = (page: Page, name: string) => sidebar(page).getByRole('button', { name: `New session in ${name}`, exact: true })

/** The group row: the smallest element that holds the toggle and the "+" of the folder. */
export const groupRow = (page: Page, name: string) =>
  sidebar(page)
    .locator('*')
    .filter({ has: toggleIn(page, name) })
    .filter({ has: page.getByRole('button', { name: `New session in ${name}`, exact: true }) })
    .last()

export const sessionsHead = (page: Page) => sidebar(page).locator('.group-head')
export const sessionsPlus = (page: Page) => sessionsHead(page).getByRole('button')
export const emptyLines = (page: Page) => sidebar(page).getByText(EMPTY, { exact: true })
export const newPageRow = (page: Page) => sidebar(page).getByRole('button', { name: 'New', exact: true })

/** An icon of `lucide-react` by its name, for example `folder` or `hand`. */
export const icon = (scope: Locator, name: string) => scope.locator(`svg.lucide-${name}`)

/** True when one of the elements shows: a box, no `display: none`, no `visibility: hidden`, and an opacity above 0.9. */
export function anyShown(locator: Locator): Promise<boolean> {
  return locator.evaluateAll((elements) => {
    interface Node {
      parentElement: Node | null
      getBoundingClientRect(): { width: number; height: number }
    }
    const win = globalThis as unknown as { getComputedStyle(node: Node): { display: string; visibility: string; opacity: string } }
    const shows = (element: Node) => {
      const box = element.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) return false
      let opacity = 1
      for (let node: Node | null = element; node; node = node.parentElement) {
        const style = win.getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden') return false
        opacity *= Number(style.opacity)
      }
      return opacity > 0.9
    }
    return (elements as unknown as Node[]).some(shows)
  })
}

/** The computed colors of the elements that show. */
export function shownColors(locator: Locator): Promise<string[]> {
  return locator.evaluateAll((elements) => {
    interface Node {
      parentElement: Node | null
      getBoundingClientRect(): { width: number; height: number }
    }
    const win = globalThis as unknown as { getComputedStyle(node: Node): { display: string; visibility: string; opacity: string; color: string } }
    const shows = (element: Node) => {
      const box = element.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) return false
      for (let node: Node | null = element; node; node = node.parentElement) {
        const style = win.getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
      }
      return true
    }
    return (elements as unknown as Node[]).filter(shows).map((element) => win.getComputedStyle(element).color)
  })
}

/** Checks that an icon shows or does not show. It polls, because a hover or a focus can start a transition. */
export async function expectShown(locator: Locator, shown: boolean, message: string): Promise<void> {
  await expect.poll(() => anyShown(locator), { message }).toBe(shown)
}

/** Checks the state of a session row: its exact name, and its description (empty for the normal state). */
export async function expectState(page: Page, title: string, state: string, check: string): Promise<void> {
  const entry = sessionEntry(page, title)
  await expect(entry, `${check}: the sidebar has no row with the exact name "${title}".`).toBeVisible()
  await expect(entry, `${check}: the accessible name of the row must stay the title "${title}".`).toHaveAccessibleName(title)
  await expect(
    entry,
    state === ''
      ? `${check}: the row "${title}" must have no state description (the normal state).`
      : `${check}: the row "${title}" must have the accessible description "${state}".`
  ).toHaveAccessibleDescription(state)
}

/** True when the element has the keyboard focus. */
export function isFocused(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const node = element as unknown as { ownerDocument: { activeElement: unknown } }
    return node.ownerDocument.activeElement === node
  })
}

/** Moves the mouse into the main region, away from the sidebar, so that no group row has the hover. */
export async function mouseAway(page: Page): Promise<void> {
  const box = await main(page).boundingBox()
  if (!box) throw new Error('The main region has no box.')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
}

/** Checks that the text "No sessions yet" shows directly under the group row of the folder. */
export async function expectEmptyUnder(page: Page, name: string, check: string): Promise<void> {
  const toggle = groupToggle(page, name)
  await expect(toggle, `${check}: the sidebar has no group "${name}" (a button named "${name}" with aria-expanded).`).toBeVisible()
  await expect(emptyLines(page).first(), `${check}: the sidebar shows no "${EMPTY}".`).toBeVisible()
  await expect
    .poll(
      async () => {
        const row = await toggle.boundingBox()
        if (!row) return false
        for (const line of await emptyLines(page).all()) {
          const box = await line.boundingBox()
          // Directly under the group row: it starts at the bottom of the row, within one row height.
          if (box && box.y >= row.y + row.height - 1 && box.y <= row.y + row.height + row.height) return true
        }
        return false
      },
      { message: `${check}: "${EMPTY}" does not show directly under the group "${name}".` }
    )
    .toBe(true)
}

// Menus.

const menus = (page: Page) => page.getByRole('menu').or(page.getByRole('group'))
export const itemsOf = (menu: Locator) => menu.getByRole('button').or(menu.getByRole('menuitem'))
export const itemIn = (menu: Locator, label: string) => itemsOf(menu).filter({ hasText: startsWithLabel(label) })

/** The "+" menu of the "Sessions" heading. */
export const sessionsMenu = (page: Page) => menus(page).filter({ hasText: 'Start session in' })

/** The right-click menu of a folder. */
export const folderMenu = (page: Page) =>
  menus(page).filter({ has: page.getByRole('button').or(page.getByRole('menuitem')).filter({ hasText: startsWithLabel('Remove folder') }) })

/** Opens the "+" menu of the "Sessions" heading. */
export async function openSessionsMenu(page: Page, check: string): Promise<Locator> {
  await expect(sessionsPlus(page), `${check}: the "Sessions" row (.group-head) must hold exactly one button, its "+".`).toHaveCount(1)
  await sessionsPlus(page).click()
  const menu = sessionsMenu(page)
  await expect(menu, `${check}: the "+" of "Sessions" opens no menu with "Start session in".`).toBeVisible()
  return menu
}

/** Opens the folder menu with a right click on the group toggle. */
export async function openFolderMenu(page: Page, name: string, check: string): Promise<Locator> {
  const toggle = groupToggle(page, name)
  await expect(toggle, `${check}: the sidebar has no group "${name}" (a button named "${name}" with aria-expanded).`).toBeVisible()
  await toggle.click({ button: 'right' })
  const menu = folderMenu(page)
  await expect(menu, `${check}: a right click on the group "${name}" opens no menu with "Remove folder".`).toBeVisible()
  return menu
}

// The main process and the window.

/** Sends the window event `focus` or `blur` to the window of the app, as the spec says. */
export async function setWindowFocus(chat: ChatApp, focused: boolean): Promise<void> {
  await chat.app.evaluate(({ BrowserWindow }, value) => {
    const [win] = BrowserWindow.getAllWindows()
    if (!win) throw new Error('The app has no window.')
    ;(win as unknown as { emit(name: string): boolean }).emit(value ? 'focus' : 'blur')
  }, focused)
}

/** Waits until the window took every event that came before: one call through the bridge, then three frames. */
export async function settle(page: Page): Promise<void> {
  await invoke(page, 'profiles.list', {})
  await nextFrames(page)
}

interface RecordGlobal {
  __s11Calls?: { contract: string; inputs: unknown[] }
  __s11Original?: (...args: unknown[]) => unknown
}

/** Records the input of each later call of the contract, in the main process. */
export async function recordCalls(chat: ChatApp, contract: string): Promise<void> {
  const installed = await chat.app.evaluate(({ ipcMain }, name) => {
    const store = globalThis as unknown as RecordGlobal
    const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, (...args: unknown[]) => unknown> })._invokeHandlers
    if (!handlers?.has('aether:invoke')) return false
    store.__s11Calls = { contract: name, inputs: [] }
    if (!store.__s11Original) {
      const original = handlers.get('aether:invoke')!
      store.__s11Original = original
      handlers.set('aether:invoke', (event: unknown, called: unknown, input: unknown) => {
        const record = store.__s11Calls
        if (record && called === record.contract) record.inputs.push(input)
        return original(event, called, input)
      })
    }
    return true
  }, contract)
  if (!installed) throw new Error('The main process has no handler of the channel aether:invoke, so the test cannot record a call.')
}

/** The inputs of the recorded calls, in order. */
export const recordedCalls = (chat: ChatApp) => chat.app.evaluate(() => (globalThis as unknown as RecordGlobal).__s11Calls?.inputs ?? [])

/** The ID of the current profile, through the bridge. */
export async function currentProfileId(page: Page): Promise<string> {
  const answer = await invoke(page, 'profiles.list', {})
  if (!answer.ok || typeof answer.value.currentId !== 'string') throw new Error(`profiles.list gave no current profile: ${JSON.stringify(answer)}`)
  return answer.value.currentId
}

/** The ID of each session of the current profile, by title, through `sessions.list`. */
export async function sessionIds(page: Page): Promise<Record<string, string>> {
  const answer = await invoke(page, 'sessions.list', { profileId: await currentProfileId(page) })
  if (!answer.ok) throw new Error(`sessions.list failed: ${JSON.stringify(answer)}`)
  const sessions = answer.value.sessions as { id: string; title: string }[]
  return Object.fromEntries(sessions.map((session) => [session.title, session.id]))
}

// Sessions and turns.

/** Opens a session from the sidebar. */
export async function openSession(page: Page, title: string, check: string): Promise<void> {
  const entry = sessionEntry(page, title)
  await expect(entry, `${check}: the sidebar does not list the session "${title}".`).toBeVisible()
  await entry.click()
  await expect(entry, `${check}: the session "${title}" does not open.`).toHaveAttribute('aria-current', 'page')
}

/** The step of the simulated agent that waits at a gate. */
export const waitAt = (name: string) => ({ do: 'gate', name }) as const

/**
 * Opens the session, sends a message, and waits until its turn waits at the gate. `prompt` are the
 * steps of the turn, and `initialize` the steps of the start of a new agent process.
 */
export async function startTurn(
  chat: ChatApp,
  page: Page,
  title: string,
  gateName: string,
  steps: { prompt?: readonly unknown[]; initialize?: readonly unknown[] },
  check: string
): Promise<void> {
  await chat.control.scenario('steps', { initialize: steps.initialize ?? [], prompt: steps.prompt ?? [] })
  await openSession(page, title, check)
  await send(page, `A message to ${title}`, check)
  await reach(chat.control.waitForGate(gateName), `${check}: the turn of "${title}" never reached the gate "${gateName}".`)
}

/** Deletes the open session through the window: "Delete session" (S3), or "Delete" or "Discard draft" of "Session options" (S10). */
export async function deleteOpenSession(page: Page, check: string): Promise<void> {
  const direct = main(page).getByRole('button', { name: 'Delete session', exact: true })
  const options = main(page).getByRole('button', { name: 'Session options', exact: true })
  await expect(direct.or(options).first(), `${check}: the session window has no way to delete the session.`).toBeVisible()
  if (await options.isVisible()) {
    await options.click()
    const menu = page.getByRole('group', { name: 'Session options', exact: true }).or(page.getByRole('menu', { name: 'Session options', exact: true }))
    const item = itemsOf(menu).filter({ hasText: /^\s*(Delete|Discard draft)/ })
    await expect(item, `${check}: the menu "Session options" has no item "Delete" or "Discard draft".`).toHaveCount(1)
    await item.click()
  } else {
    await direct.click()
  }
  const dialog = page.getByRole('dialog', { name: /^Delete/ })
  await expect(dialog, `${check}: the delete asks nothing.`).toBeVisible()
  await dialog.getByRole('button', { name: 'Delete session', exact: true }).click()
  await expect(dialog).toBeHidden()
}

/** The reply of each turn in these tests. */
export const REPLY = 'Done.'
export const replyStep = { do: 'say', text: REPLY } as const

/** Checks that the open session shows the reply. */
export async function expectReplyShown(page: Page, check: string): Promise<void> {
  await expect(transcript(page).getByText(REPLY, { exact: true }).last(), `${check}: the session window does not show the reply "${REPLY}".`).toBeVisible()
}

// Two profiles.

export const PROFILES = { personal: 'Personal', client: 'Client Example' } as const
export type Profile = keyof typeof PROFILES

/** The workspace directory of a profile. The one of "Personal" is the directory of the S4 fixture. */
export const directoryOf = (chat: ChatApp, profile: Profile) => (profile === 'personal' ? chat.directory : join(chat.root, 'directories', 'client'))

export interface ProfileDraft {
  prompt: string
  profile: Profile
  folder: string
  createdAt: string
}

/** Writes the old `workspace.json` of version 4 with both profiles and their drafts. Creates each folder. */
export async function writeTwoProfiles(chat: ChatApp, drafts: ProfileDraft[]): Promise<void> {
  for (const profile of Object.keys(PROFILES) as Profile[]) await mkdir(directoryOf(chat, profile), { recursive: true })
  for (const draft of drafts) await mkdir(draft.folder, { recursive: true })
  const file = {
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
      accountId: draft.profile,
      title: draft.prompt,
      prompt: draft.prompt,
      settings: { folder: draft.folder, mode: 'interactive', permissions: 'ask', model: 'default', checkout: 'folder', attachments: [] },
      createdAt: draft.createdAt
    }))
  }
  await writeFile(join(chat.dataDir, 'workspace.json'), JSON.stringify(file, null, 2))
}

/** Starts the app on the old file with both profiles and answers the import dialog. */
export async function startTwoProfiles(chat: ChatApp): Promise<Page> {
  const page = await chat.start()
  await answerDirectoryDialog(page, { [PROFILES.personal]: directoryOf(chat, 'personal'), [PROFILES.client]: directoryOf(chat, 'client') })
  return page
}

/** The creation time of day `n` of January 2026. */
export const day = (n: number) => `2026-01-${String(n).padStart(2, '0')}T00:00:00.000Z`
