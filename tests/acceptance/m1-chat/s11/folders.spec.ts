// S11 of milestone m1-chat, on the built app: the folders of a profile (A24).
// Spec: `docs/milestones/m1-chat/stories/s11-sidebar-status.md`, checks S11-13, S11-14, S11-15 and
// S11-24. The UI contract is in `fixture.ts`.
//
// The folder picker. The spec names "the picker test hook of S3". S3 has none; the tests use
// `stubPickers` of S7, which replaces `dialog.showOpenDialog` in the main process of the running app.
// A restart needs a new stub; these tests pick a folder only once, before any restart.
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  currentProfileId,
  day,
  directoryOf,
  expect,
  expectEmptyUnder,
  groupToggle,
  icon,
  invoke,
  itemIn,
  itemsOf,
  openFolderMenu,
  openSessionsMenu,
  PROFILES,
  sessionEntry,
  settle,
  startImported,
  startTwoProfiles,
  stubPickers,
  switchProfile,
  test,
  writeOldProfile,
  writeTwoProfiles,
  type ChatApp
} from './fixture'

const DRAFTS = [
  { prompt: 'Rename the old files', folder: 'repo-a', createdAt: day(1) },
  { prompt: 'Sort the notes', folder: 'repo-b', createdAt: day(2) }
] as const

async function startWithDrafts(chat: ChatApp) {
  await writeOldProfile(chat, [...DRAFTS])
  return startImported(chat)
}

test.describe('S11 folders: saved collapse, the "+" menu, added and removed folders', () => {
  test('S11-13: a collapsed group stays collapsed after a restart and after a switch to another profile and back; the other profile is not affected', async ({
    chat
  }) => {
    const check = 'S11-13'
    // Both profiles have a session in the same folder, so a collapse that does not belong to its profile shows.
    const shared = join(directoryOf(chat, 'personal'), 'repo-a')
    await writeTwoProfiles(chat, [
      { prompt: 'Rename the old files', profile: 'personal', folder: shared, createdAt: day(1) },
      { prompt: 'Sort the notes', profile: 'personal', folder: join(directoryOf(chat, 'personal'), 'repo-b'), createdAt: day(2) },
      { prompt: 'Review the invoice export', profile: 'client', folder: shared, createdAt: day(3) }
    ])
    let page = await startTwoProfiles(chat)
    const toggle = () => groupToggle(page, 'repo-a')
    await expect(toggle(), `${check}: the sidebar has no group "repo-a" (a button named "repo-a" with aria-expanded).`).toHaveAttribute('aria-expanded', 'true')
    await toggle().click()
    await expect(toggle(), `${check}: the group "repo-a" does not collapse.`).toHaveAttribute('aria-expanded', 'false')
    // The save of the collapse reaches the main process before the app stops.
    await settle(page)

    await chat.stop()
    page = await chat.start()
    await expect(toggle(), `${check}: after a restart, the group "repo-a" of "Personal" must still be collapsed.`).toHaveAttribute('aria-expanded', 'false')
    await expect(sessionEntry(page, 'Rename the old files'), `${check}: after a restart, the rows of the collapsed group must stay hidden.`).toBeHidden()

    await switchProfile(page, PROFILES.personal, PROFILES.client)
    await expect(toggle(), `${check}: the group "repo-a" of "Client Example" must be expanded: the collapse belongs to "Personal".`).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    await expect(sessionEntry(page, 'Review the invoice export'), `${check}: the session of "Client Example" must show.`).toBeVisible()

    await switchProfile(page, PROFILES.client, PROFILES.personal)
    await expect(toggle(), `${check}: after the switch back, the group "repo-a" of "Personal" must still be collapsed.`).toHaveAttribute('aria-expanded', 'false')
    await expect(sessionEntry(page, 'Sort the notes'), `${check}: the group "repo-b" of "Personal" must stay expanded.`).toBeVisible()
  })

  test('S11-14: the "+" menu of "Sessions" shows "Start session in" with the two folders, "Add from GitHub" and "Add from URL" disabled with "Coming soon", and "Add local folder or repository"', async ({
    chat
  }) => {
    const check = 'S11-14'
    const page = await startWithDrafts(chat)
    const menu = await openSessionsMenu(page, check)
    for (const name of ['repo-a', 'repo-b']) {
      const row = itemIn(menu, name)
      await expect(row, `${check}: the "+" menu has no row for the folder "${name}".`).toHaveCount(1)
      await expect(row, `${check}: the row "${name}" of the "+" menu must be enabled.`).toBeEnabled()
      await expect(icon(row, 'folder'), `${check}: the row "${name}" of the "+" menu has no folder icon.`).toHaveCount(1)
    }
    for (const label of ['Add from GitHub', 'Add from URL']) {
      const item = itemIn(menu, label)
      await expect(item, `${check}: the "+" menu has no item "${label}".`).toHaveCount(1)
      await expect(item, `${check}: "${label}" must be disabled.`).toBeDisabled()
      await expect(item, `${check}: "${label}" must show "Coming soon".`).toContainText('Coming soon')
    }
    const add = itemIn(menu, 'Add local folder or repository')
    await expect(add, `${check}: the "+" menu has no item "Add local folder or repository".`).toHaveCount(1)
    await expect(add, `${check}: "Add local folder or repository" must be enabled.`).toBeEnabled()
    // The order of the menu: the folders, then the two coming-soon items, then the local folder.
    const labels = (await itemsOf(menu).allInnerTexts()).map((text) => text.trim())
    const at = (label: string) => labels.findIndex((text) => text.startsWith(label))
    expect(at('repo-a') >= 0 && at('repo-b') >= 0, `${check}: the folders must be items of the "+" menu: ${JSON.stringify(labels)}.`).toBe(true)
    expect(
      Math.max(at('repo-a'), at('repo-b')) < at('Add from GitHub') && at('Add from GitHub') < at('Add from URL') && at('Add from URL') < at('Add local folder or repository'),
      `${check}: the "+" menu must list the folders, "Add from GitHub", "Add from URL", then "Add local folder or repository": ${JSON.stringify(labels)}.`
    ).toBe(true)
  })

  test('S11-15: "Add local folder or repository" adds a group with "No sessions yet" that stays after a restart; "Remove folder" of its right-click menu removes it', async ({
    chat
  }) => {
    const check = 'S11-15'
    let page = await startWithDrafts(chat)
    const notes = join(chat.directory, 'empty-notes')
    await mkdir(notes, { recursive: true })
    await stubPickers(chat, { files: [], folders: [notes] })

    const menu = await openSessionsMenu(page, check)
    await itemIn(menu, 'Add local folder or repository').click()
    await expectEmptyUnder(page, 'empty-notes', `${check}: after "Add local folder or repository"`)
    await settle(page)

    await chat.stop()
    page = await chat.start()
    await expectEmptyUnder(page, 'empty-notes', `${check}: after a restart`)

    const folderMenu = await openFolderMenu(page, 'empty-notes', check)
    const remove = itemIn(folderMenu, 'Remove folder')
    await expect(remove, `${check}: "Remove folder" must be enabled for a folder with no sessions.`).toBeEnabled()
    await remove.click()
    await expect(groupToggle(page, 'empty-notes'), `${check}: "Remove folder" did not remove the group "empty-notes".`).toHaveCount(0)
    await expect(groupToggle(page, 'repo-a'), `${check}: "Remove folder" removed another group.`).toBeVisible()
  })

  test('S11-24: the right-click menu of a folder shows "New session" and "Remove folder"; it removes the empty folder F, it is disabled for G with a session, and Escape closes the menu', async ({
    chat
  }) => {
    const check = 'S11-24'
    // G is repo-b, with one session. F is an empty folder that the profile adds.
    await writeOldProfile(chat, [{ prompt: 'Sort the notes', folder: 'repo-b', createdAt: day(1) }])
    const page = await startImported(chat)
    const empty = join(chat.directory, 'empty-notes')
    await mkdir(empty, { recursive: true })
    const added = await invoke(page, 'folders.add', { profileId: await currentProfileId(page), path: empty })
    expect(added.ok, `${check}: folders.add refused the empty folder F: ${JSON.stringify(added)}`).toBe(true)
    // The sidebar loads the folders of the profile at its start.
    await page.reload()
    await expect(groupToggle(page, 'empty-notes'), `${check}: the sidebar has no group for the empty folder F.`).toBeVisible()
    await expect(groupToggle(page, 'repo-b'), `${check}: the sidebar has no group for the folder G.`).toBeVisible()

    // F: the menu has "New session" and "Remove folder". Escape closes it.
    let menu = await openFolderMenu(page, 'empty-notes', check)
    const labels = (await itemsOf(menu).allInnerTexts()).map((text) => text.trim())
    expect(
      labels.length === 2 && labels[0]!.startsWith('New session') && labels[1]!.startsWith('Remove folder'),
      `${check}: the folder menu must have the items "New session" and "Remove folder", in this order: ${JSON.stringify(labels)}.`
    ).toBe(true)
    await expect(itemIn(menu, 'Remove folder'), `${check}: "Remove folder" must be enabled for the empty folder F.`).toBeEnabled()
    await page.keyboard.press('Escape')
    await expect(menu, `${check}: Escape does not close the folder menu.`).toBeHidden()

    // G has a session: "Remove folder" is disabled.
    menu = await openFolderMenu(page, 'repo-b', check)
    await expect(itemIn(menu, 'New session'), `${check}: the folder menu of G has no "New session".`).toHaveCount(1)
    await expect(itemIn(menu, 'Remove folder'), `${check}: "Remove folder" must be disabled for the folder G, which has a session.`).toBeDisabled()
    await page.keyboard.press('Escape')
    await expect(menu, `${check}: Escape does not close the folder menu of G.`).toBeHidden()

    // F: "Remove folder" removes the group.
    menu = await openFolderMenu(page, 'empty-notes', check)
    await itemIn(menu, 'Remove folder').click()
    await expect(groupToggle(page, 'empty-notes'), `${check}: "Remove folder" did not remove the group of F.`).toHaveCount(0)
    await expect(groupToggle(page, 'repo-b'), `${check}: "Remove folder" of F removed the group of G.`).toBeVisible()
  })
})
