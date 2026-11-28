// S11 of milestone m1-chat, on the built app: the groups of the sidebar (A24).
// Spec: `docs/milestones/m1-chat/stories/s11-sidebar-status.md`, checks S11-1, S11-2, S11-3, S11-4
// and S11-16. The UI contract is in `fixture.ts`.
//
// The data: drafts of the old file in the plain folders `repo-a` and `repo-b` of the workspace
// directory. The newest draft is in `repo-a`, so the composer of a new session starts with `repo-a`.
import {
  day,
  deleteOpenSession,
  expect,
  expectEmptyUnder,
  expectShown,
  folderPath,
  groupPlus,
  groupRow,
  groupToggle,
  icon,
  invoke,
  currentProfileId,
  main,
  mouseAway,
  newPageRow,
  openSession,
  sessionEntry,
  sessionsHead,
  isFocused,
  sessionsPlus,
  startImported,
  test,
  writeOldProfile,
  type ChatApp
} from './fixture'

const DRAFTS = [
  { prompt: 'Rename the old files', folder: 'repo-a', createdAt: day(1) },
  { prompt: 'Sort the notes', folder: 'repo-b', createdAt: day(2) },
  { prompt: 'Fix the login page', folder: 'repo-a', createdAt: day(3) }
] as const

async function startWithDrafts(chat: ChatApp) {
  await writeOldProfile(chat, [...DRAFTS])
  return startImported(chat)
}

test.describe('S11 groups: each folder is a group row with a folder icon, a toggle and a "+"', () => {
  test('S11-1: two folders with sessions show two group rows with a folder icon and the folder name; the first starts 0 to 4 px under "Sessions"; session rows are indented', async ({
    chat
  }) => {
    const check = 'S11-1'
    const page = await startWithDrafts(chat)
    await mouseAway(page)
    for (const name of ['repo-a', 'repo-b']) {
      const toggle = groupToggle(page, name)
      await expect(toggle, `${check}: the sidebar has no group row "${name}" (a button named exactly "${name}" with aria-expanded).`).toBeVisible()
      await expect(toggle, `${check}: the group "${name}" must start expanded.`).toHaveAttribute('aria-expanded', 'true')
      await expectShown(icon(toggle, 'folder'), true, `${check}: the group row "${name}" shows no folder icon.`)
    }

    // Spacing (rule 4): the first group row starts directly under the "Sessions" row.
    const head = await sessionsHead(page).boundingBox()
    if (!head) throw new Error(`${check}: the sidebar has no "Sessions" row (.group-head).`)
    const firstRow = await groupRow(page, 'repo-a').boundingBox()
    if (!firstRow) throw new Error(`${check}: the group row "repo-a" (the toggle and its "+") has no box.`)
    const gap = firstRow.y - (head.y + head.height)
    expect(gap, `${check}: the first group row must start 0 to 4 px under the "Sessions" row, not ${gap.toFixed(1)} px.`).toBeGreaterThanOrEqual(-0.5)
    expect(gap, `${check}: the first group row must start 0 to 4 px under the "Sessions" row, not ${gap.toFixed(1)} px.`).toBeLessThanOrEqual(4.5)

    // Indent (rule 5): the icon of a session row is one icon width (28 px) right of the folder icon.
    for (const [title, name] of [
      ['Fix the login page', 'repo-a'],
      ['Sort the notes', 'repo-b']
    ] as const) {
      const folderIcon = await icon(groupToggle(page, name), 'folder').first().boundingBox()
      const rowIcon = await sessionEntry(page, title).locator('svg').first().boundingBox()
      if (!folderIcon || !rowIcon) throw new Error(`${check}: the folder icon of "${name}" or the icon of the row "${title}" has no box.`)
      const indent = rowIcon.x - folderIcon.x
      expect(
        Math.abs(indent - 28),
        `${check}: the row "${title}" must be indented 28 px under its group "${name}", not ${indent.toFixed(1)} px.`
      ).toBeLessThanOrEqual(4)
    }
  })

  test('S11-2: on hover of a group row, and with the keyboard focus on its toggle, the chevron replaces the folder icon and "New session in <name>" shows', async ({
    chat
  }) => {
    const check = 'S11-2'
    const page = await startWithDrafts(chat)
    const toggle = groupToggle(page, 'repo-a')
    const plus = groupPlus(page, 'repo-a')
    await expect(toggle, `${check}: the sidebar has no group "repo-a" (a button named "repo-a" with aria-expanded).`).toBeVisible()

    // At rest: the folder icon, no chevron, no "+".
    await mouseAway(page)
    await expectShown(icon(toggle, 'folder'), true, `${check}: with no hover, the group "repo-a" shows no folder icon.`)
    await expect(plus, `${check}: the group "repo-a" has no button "New session in repo-a".`).toHaveCount(1)
    await expectShown(plus, false, `${check}: with no hover and no focus, "New session in repo-a" must not show.`)

    // Hover.
    await toggle.hover()
    await expectShown(icon(toggle, 'chevron-down'), true, `${check}: on hover, the expanded group "repo-a" shows no chevron down.`)
    await expectShown(icon(toggle, 'folder'), false, `${check}: on hover, the folder icon must give its place to the chevron.`)
    await expectShown(plus, true, `${check}: on hover, "New session in repo-a" does not show.`)

    // Keyboard: no hover, Tab from the "+" of "Sessions" until the toggle has the focus.
    await mouseAway(page)
    await expectShown(plus, false, `${check}: after the hover, "New session in repo-a" must hide again.`)
    await sessionsPlus(page).first().focus()
    for (let presses = 0; presses < 30 && !(await isFocused(toggle)); presses += 1) {
      await page.keyboard.press('Tab')
    }
    await expect(toggle, `${check}: Tab does not reach the toggle of the group "repo-a".`).toBeFocused()
    await expectShown(icon(toggle, 'chevron-down'), true, `${check}: with the focus on the toggle, the group "repo-a" shows no chevron down.`)
    await expectShown(icon(toggle, 'folder'), false, `${check}: with the focus on the toggle, the folder icon must give its place to the chevron.`)
    await expectShown(plus, true, `${check}: with the focus on the toggle, "New session in repo-a" does not show.`)
    await page.keyboard.press('Tab')
    await expect(plus, `${check}: Tab from the toggle must reach "New session in repo-a".`).toBeFocused()
    await expectShown(plus, true, `${check}: with the focus on it, "New session in repo-a" does not show.`)
  })

  test('S11-3: a click, then Enter, then Space on the toggle set aria-expanded false, true, false, and hide and show the rows of the group', async ({ chat }) => {
    const check = 'S11-3'
    const page = await startWithDrafts(chat)
    const toggle = groupToggle(page, 'repo-a')
    const rows = ['Fix the login page', 'Rename the old files']
    await expect(toggle, `${check}: the sidebar has no group "repo-a" (a button named "repo-a" with aria-expanded).`).toHaveAttribute('aria-expanded', 'true')

    const expectRows = async (shown: boolean, when: string) => {
      for (const title of rows) {
        const entry = sessionEntry(page, title)
        if (shown) await expect(entry, `${check}: after ${when}, the row "${title}" must show.`).toBeVisible()
        else await expect(entry, `${check}: after ${when}, the row "${title}" must hide.`).toBeHidden()
      }
      await expect(sessionEntry(page, 'Sort the notes'), `${check}: after ${when}, the row of the other group "repo-b" must still show.`).toBeVisible()
    }

    await toggle.click()
    await expect(toggle, `${check}: a click on the toggle must set aria-expanded="false".`).toHaveAttribute('aria-expanded', 'false')
    await expectRows(false, 'the click')

    await toggle.press('Enter')
    await expect(toggle, `${check}: Enter on the toggle must set aria-expanded="true".`).toHaveAttribute('aria-expanded', 'true')
    await expectRows(true, 'Enter')

    await toggle.press(' ')
    await expect(toggle, `${check}: Space on the toggle must set aria-expanded="false".`).toHaveAttribute('aria-expanded', 'false')
    await expectRows(false, 'Space')
  })

  test('S11-4: with the New page open with folder F, "New session in G" makes the composer show G and creates no session', async ({ chat }) => {
    const check = 'S11-4'
    const page = await startWithDrafts(chat)
    const folderF = folderPath(chat, 'repo-a')
    const folderG = folderPath(chat, 'repo-b')
    const composerFolder = (path: string) => main(page).getByRole('button', { name: path, exact: true })

    await newPageRow(page).click()
    await expect(main(page).getByRole('button', { name: 'Start session', exact: true }), `${check}: the New page does not show the composer.`).toBeVisible()
    await expect(composerFolder(folderF), `${check}: the New page must start with the folder F of the newest session (${folderF}).`).toBeVisible()
    const listed = async () => {
      const answer = await invoke(page, 'sessions.list', { profileId: await currentProfileId(page) })
      if (!answer.ok) throw new Error(`${check}: sessions.list failed: ${JSON.stringify(answer)}`)
      return (answer.value.sessions as unknown[]).length
    }
    const sessions = await listed()

    await expect(groupToggle(page, 'repo-b'), `${check}: the sidebar has no group "repo-b" (a button named "repo-b" with aria-expanded).`).toBeVisible()
    await groupToggle(page, 'repo-b').hover()
    const plus = groupPlus(page, 'repo-b')
    await expect(plus, `${check}: the group "repo-b" has no button "New session in repo-b".`).toBeVisible()
    await plus.click()
    await expect(composerFolder(folderG), `${check}: after "New session in repo-b", the composer must show the folder G (${folderG}).`).toBeVisible()
    await expect(composerFolder(folderF), `${check}: after "New session in repo-b", the composer still shows the folder F.`).toHaveCount(0)
    await expect(main(page).getByRole('button', { name: 'Start session', exact: true }), `${check}: "New session in repo-b" must keep the composer of a new session.`).toBeVisible()

    // No session is created.
    expect(await listed(), `${check}: "New session in repo-b" created a session.`).toBe(sessions)
  })

  test('S11-16: when the user deletes the one session of a folder, its group stays with "No sessions yet"', async ({ chat }) => {
    const check = 'S11-16'
    const page = await startWithDrafts(chat)
    await expect(groupToggle(page, 'repo-b'), `${check}: the sidebar has no group "repo-b" (a button named "repo-b" with aria-expanded).`).toBeVisible()
    await openSession(page, 'Sort the notes', check)
    await deleteOpenSession(page, check)
    await expect(sessionEntry(page, 'Sort the notes'), `${check}: the deleted session still shows in the sidebar.`).toHaveCount(0)
    await expectEmptyUnder(page, 'repo-b', check)
    // The other group keeps its sessions.
    await expect(sessionEntry(page, 'Fix the login page'), `${check}: the group "repo-a" lost its sessions.`).toBeVisible()
  })
})
