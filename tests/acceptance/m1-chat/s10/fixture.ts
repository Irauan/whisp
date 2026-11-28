// The fixture of the S10 tests of milestone m1-chat: the session title from the agent, the title
// strip and its menu. Spec: `docs/milestones/m1-chat/stories/s10-session-title.md` and its mockup
// `s10-session-title.mockup.html` (approved by the user on 2026-11-28).
//
// The setup is the chat fixture of S4 (`../s4/fixture.ts`): the built app in a temporary data
// folder, a temporary APPDATA and home, the fake `gh`, the simulated agent as Claude Code in
// `agents.json`, and the check that the real data folder (`%APPDATA%\aether`) does not change.
// The profile "Personal" and its drafts come from an old `workspace.json`, in the plain folders
// `repo-a` and `repo-b`, so Aether asks no trust question (S6). All data is fake. The product has
// no test hook.
//
// The agent. The simulated agent is used as it is (its files are locked). The scenario `steps`
// sends a title with the step `{ do: 'update', update: { sessionUpdate: 'session_info_update',
// title } }`, as the Claude adapter sends it. A title outside a turn comes from `{ do: 'detach',
// steps }`, behind a gate that the test opens after the turn ended.
//
// No test sleeps. A test waits on an auto-waiting check of Playwright, or on a report of the
// simulated agent through `reach`. A check that something does not change first waits for a later
// fact (a reply after the title, or the row of the other session), so it cannot pass too early.
//
// The UI that these tests expect (S10 test contract). The S1 to S9 contracts stay, with the changes
// of the S3 and S8 contracts that S10 makes (the title and "Delete session" move into the title
// strip and its menu).
// - Title: the title of the open session is the heading of level 1 in the main region (role
//   `main`). It is in the title strip at the top of the main area, on the line of the sidebar
//   button "Search": its vertical center is in the top 44 px of the window. It is plain text: a
//   click on it opens no menu, no dialog and no text field.
// - The arrow: a button named exactly "Session options". It follows the title on the same line, at
//   the right of the title. Only this button opens the menu.
// - No header row: the session window has no button "Delete session" outside the menu, and no
//   visible button other than "Session options" above the log "Transcript".
// - The menu: an element with the role `group` (as `Menu.tsx` gives it) or `menu`, named exactly
//   "Session options". Its items are the elements with the role `button` or `menuitem` in it, in
//   the order of the screen. A separator is not an item.
// - The text of each item starts with its label. The labels are "Rename", "Fork", "Archive" and
//   "Delete" for a started session, in this order, and only "Discard draft" for a draft.
// - Each item has an icon: an `svg` element in the item.
// - "Fork" and "Archive" are disabled, and each shows the text "Coming soon".
// - The shortcut letter of an item is an element in it with the exact text of the letter: "R" in
//   "Rename" and "D" in "Delete".
// - Escape closes the open menu, and the focus is then on "Session options".
// - "Delete" opens the confirmation of today (S3 contract): a `dialog` whose name starts with
//   "Delete", with the buttons "Cancel" and "Delete session".
// - Rename: the item "Rename" turns the title into a text field named exactly "Session title"
//   (the spec gives no name; the test author chose this one). Enter saves. Escape cancels and keeps
//   the old title. A blank title is refused: the field stays, and the title does not change.
// - Draft: a saved session that has not started, as in the S3 and S8 specs (here a draft of the
//   import). Its title is "New session", and its menu holds only "Discard draft".
// - Sidebar: a session shows as a button with its exact title (S3 contract). A title change shows in
//   the sidebar without a restart and without a click, also for a session that is not open.
import { expect, type Locator, type Page } from '@playwright/test'
import { main, sessionEntry, transcript, type ChatApp } from '../s4/fixture'

export * from '../s4/fixture'

/** The height of the title strip (spec, "Header layout": `.title-strip`, 44 px). */
export const STRIP_HEIGHT = 44

/** The `session/update` of a title, as the Claude adapter sends it. */
export const titleUpdate = (title: string) =>
  ({ do: 'update', update: { sessionUpdate: 'session_info_update', title, updatedAt: '2026-11-28T10:00:00.000Z' } }) as const

/** The heading of level 1 of the main region: the title of the open session. */
export const titleHeading = (page: Page) => main(page).getByRole('heading', { level: 1 })

/** The arrow button that opens the menu. */
export const optionsButton = (page: Page) => main(page).getByRole('button', { name: 'Session options', exact: true })

/** The menu that the arrow opens. */
export const optionsMenu = (page: Page) =>
  page.getByRole('group', { name: 'Session options', exact: true }).or(page.getByRole('menu', { name: 'Session options', exact: true }))

/** The items of the open menu, in the order of the screen. */
export const menuItems = (page: Page) => optionsMenu(page).getByRole('button').or(optionsMenu(page).getByRole('menuitem'))

const escaped = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The item of the open menu whose text starts with the label. */
export const menuItem = (page: Page, label: string) => menuItems(page).filter({ hasText: new RegExp(`^\\s*${escaped(label)}`) })

/** The text field of Rename. */
export const renameField = (page: Page) => main(page).getByRole('textbox', { name: 'Session title', exact: true })

/** The confirmation of Delete, as today (S3 contract). */
export const deleteDialog = (page: Page) => page.getByRole('dialog', { name: /^Delete/ })

/** The sidebar button "Search": the title strip is on its line. */
export const searchButton = (page: Page) => page.getByRole('button', { name: 'Search', exact: true })

/** Opens the menu with the arrow. */
export async function openMenu(page: Page, check: string): Promise<void> {
  const arrow = optionsButton(page)
  await expect(arrow, `${check}: the session window has no button "Session options" (the arrow of the title strip).`).toBeVisible()
  await arrow.click()
  await expect(optionsMenu(page), `${check}: the button "Session options" opens no menu "Session options".`).toBeVisible()
}

/** Opens the menu and chooses one item. */
export async function chooseItem(page: Page, label: string, check: string): Promise<void> {
  await openMenu(page, check)
  const item = menuItem(page, label)
  await expect(item, `${check}: the menu "Session options" has no item "${label}".`).toHaveCount(1)
  await expect(item, `${check}: the item "${label}" of the menu is disabled.`).toBeEnabled()
  await item.click()
}

/** Checks that the window and the sidebar show the title. */
export async function expectTitle(page: Page, title: string, check: string): Promise<void> {
  await expect(titleHeading(page), `${check}: the session window does not show the title "${title}".`).toHaveText(title)
  await expect(sessionEntry(page, title), `${check}: the sidebar has no row with the title "${title}".`).toBeVisible()
}

/** The box of an element. It fails with the check when the element has none. */
export async function boxOf(locator: Locator, what: string, check: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox()
  if (!box) throw new Error(`${check}: ${what} has no box on the screen.`)
  return box
}

/** The names of the visible buttons of the main region that end above the top of the log "Transcript". */
export async function buttonsAboveTranscript(page: Page): Promise<string[]> {
  const top = (await transcript(page).boundingBox())?.y ?? 0
  const above: string[] = []
  for (const button of await main(page).getByRole('button').filter({ visible: true }).all()) {
    const box = await button.boundingBox()
    if (box && box.y + box.height <= top + 1) above.push((await button.getAttribute('aria-label')) ?? (await button.innerText()))
  }
  return above
}

/** Quits and starts Aether, and opens the session with this title. */
export async function restartAndOpen(chat: ChatApp, title: string, check: string): Promise<Page> {
  await chat.stop()
  const page = await chat.start()
  const entry = sessionEntry(page, title)
  await expect(entry, `${check}: after a restart, the sidebar does not list the session "${title}".`).toBeVisible()
  await entry.click()
  await expect(entry, `${check}: after a restart, the session "${title}" does not open.`).toHaveAttribute('aria-current', 'page')
  return page
}
