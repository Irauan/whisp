// The title strip and the session menu, story S10 of milestone m1-chat, on the built app.
//
// Spec `s10-session-title.md`, "Header layout" (user decision, 2026-11-28), and the mockup
// `s10-session-title.mockup.html`, states 1 to 3: the title moves into the title strip of the main
// area, on the line of the sidebar buttons. The S8 header row goes away. A separate arrow button
// "Session options" follows the title, and only the arrow opens the menu. The menu has the items of
// the Claude app that Aether can support, in the GitHub style: an icon in each row, and the shortcut
// letter at the right.
//
// S10-10: the title strip holds the title and "Session options". No header row with a trash button shows.
// S10-11: a click on the title opens nothing. The arrow opens the menu, and "Delete" asks the
//         confirmation of today.
// S10-12: a draft shows the title "New session", and its menu shows "Discard draft".
// S10-13: Escape closes the menu, and the focus goes back to the arrow.
// S10-15: the items are "Rename", "Fork", "Archive" and "Delete", in this order. "Fork" and
//         "Archive" are disabled with "Coming soon". Each row has an icon. "Rename" shows "R" and
//         "Delete" shows "D".
//
// `fixture.ts` describes the UI contract. No test sleeps.
import {
  boxOf,
  buttonsAboveTranscript,
  chooseItem,
  deleteDialog,
  DRAFT_IN_REPO_A,
  expect,
  expectInTranscript,
  main,
  menuItem,
  menuItems,
  openMenu,
  optionsButton,
  optionsMenu,
  renameField,
  searchButton,
  sessionEntry,
  startImported,
  startSession,
  stopButton,
  STRIP_HEIGHT,
  test,
  titleHeading,
  transcript,
  writeOldProfile,
  type ChatApp
} from './fixture'

/** Starts the session "Say hello" from the composer, and waits until its turn ended. */
async function startedSession(chat: ChatApp, check: string) {
  await chat.control.scenario('text', { chunks: ['Hello ', 'from the agent.'] })
  await writeOldProfile(chat, [DRAFT_IN_REPO_A])
  const page = await startImported(chat)
  await startSession(page, 'Say hello', check)
  await expectInTranscript(page, 'Hello from the agent.', `${check}: the reply does not show.`)
  await expect(stopButton(page), `${check}: the turn does not end.`).toHaveCount(0)
  return page
}

const centerOf = (box: { y: number; height: number }) => box.y + box.height / 2

/** Two elements are on one line when their vertical centers differ by this many pixels or less. */
const SAME_LINE = 8

test.describe('S10: the title strip and the menu "Session options"', () => {
  test('S10-10: the title strip holds the title and the button "Session options", and no header row with a trash button shows', async ({ chat }) => {
    const check = 'S10-10'
    const page = await startedSession(chat, check)

    const heading = titleHeading(page)
    const arrow = optionsButton(page)
    await expect(heading, `${check}: the session window does not show the title "Say hello" as a heading of level 1.`).toHaveText('Say hello')
    await expect(arrow, `${check}: the session window has no button "Session options" (the arrow of the title strip).`).toBeVisible()

    // The title and the arrow are in the strip at the top, on the line of the sidebar button "Search".
    const title = await boxOf(heading, 'the title', check)
    const button = await boxOf(arrow, 'the button "Session options"', check)
    const search = await boxOf(searchButton(page), 'the sidebar button "Search"', check)
    for (const [what, box] of [
      ['the title', title],
      ['the button "Session options"', button]
    ] as const) {
      expect(centerOf(box), `${check}: ${what} is not in the title strip: its center must be in the top ${STRIP_HEIGHT} px of the window.`).toBeLessThanOrEqual(
        STRIP_HEIGHT
      )
      expect(
        Math.abs(centerOf(box) - centerOf(search)),
        `${check}: ${what} is not on the line of the sidebar button "Search".`
      ).toBeLessThanOrEqual(SAME_LINE)
    }
    // The arrow follows the title, at its right.
    expect(button.x, `${check}: the button "Session options" must follow the title, at its right.`).toBeGreaterThanOrEqual(title.x + title.width - 1)

    // No header row: the log starts below the strip, and the only button above it is the arrow.
    const log = await boxOf(transcript(page), 'the log "Transcript"', check)
    expect(log.y, `${check}: the log "Transcript" must start below the title strip.`).toBeGreaterThanOrEqual(Math.max(title.y + title.height, button.y + button.height) - 1)
    await expect(
      main(page).getByRole('button', { name: 'Delete session', exact: true }).filter({ visible: true }),
      `${check}: the session window still shows a header button "Delete session". It must be an item of the menu.`
    ).toHaveCount(0)
    expect(await buttonsAboveTranscript(page), `${check}: above the log, the only button must be "Session options".`).toEqual(['Session options'])
  })

  test('S10-11: a click on the title opens nothing, the arrow opens the menu, and "Delete" asks the same confirmation as today', async ({ chat }) => {
    const check = 'S10-11'
    const page = await startedSession(chat, check)

    // The title is plain text.
    await expect(titleHeading(page), `${check}: the session window does not show the title "Say hello".`).toHaveText('Say hello')
    await titleHeading(page).click()
    await expect(optionsMenu(page), `${check}: a click on the title opened the menu. Only the arrow opens it.`).toBeHidden()
    await expect(page.getByRole('dialog'), `${check}: a click on the title opened a dialog.`).toHaveCount(0)
    await expect(renameField(page), `${check}: a click on the title opened the text field of Rename.`).toHaveCount(0)

    // The arrow opens the menu with "Delete".
    await openMenu(page, check)
    await expect(menuItem(page, 'Delete'), `${check}: the menu "Session options" has no item "Delete".`).toHaveCount(1)

    // "Delete" asks first. Cancel keeps the session.
    await menuItem(page, 'Delete').click()
    let dialog = deleteDialog(page)
    await expect(dialog, `${check}: "Delete" does not ask first with the dialog of today.`).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Delete session', exact: true }), `${check}: the dialog has no button "Delete session".`).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(sessionEntry(page, 'Say hello'), `${check}: Cancel deleted the session.`).toBeVisible()

    // "Delete session" in the dialog deletes it.
    await chooseItem(page, 'Delete', check)
    dialog = deleteDialog(page)
    await expect(dialog, `${check}: the second "Delete" does not ask first.`).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete session', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(sessionEntry(page, 'Say hello'), `${check}: the sidebar still lists the deleted session.`).toHaveCount(0)
    await expect(main(page).getByRole('heading', { name: 'Say hello', exact: true }), `${check}: the window still shows the deleted session.`).toHaveCount(0)
  })

  test('S10-12: a draft shows the title "New session", and its menu shows "Discard draft"', async ({ chat }) => {
    const check = 'S10-12'
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    const entry = sessionEntry(page, DRAFT_IN_REPO_A.prompt)
    await expect(entry, `${check}: the sidebar does not list the draft "${DRAFT_IN_REPO_A.prompt}".`).toBeVisible()
    await entry.click()
    await expect(entry, `${check}: the draft does not open.`).toHaveAttribute('aria-current', 'page')

    await expect(titleHeading(page), `${check}: the draft must show the title "New session".`).toHaveText('New session')
    await openMenu(page, check)
    await expect(menuItems(page), `${check}: the menu of a draft must hold only one item.`).toHaveCount(1)
    await expect(menuItem(page, 'Discard draft'), `${check}: the menu of a draft has no item "Discard draft".`).toHaveCount(1)
  })

  test('S10-13: Escape closes the menu, and the focus is on the arrow', async ({ chat }) => {
    const check = 'S10-13'
    const page = await startedSession(chat, check)
    await openMenu(page, check)

    await page.keyboard.press('Escape')
    await expect(optionsMenu(page), `${check}: Escape does not close the menu.`).toBeHidden()
    await expect(optionsButton(page), `${check}: after Escape, the focus is not on the button "Session options".`).toBeFocused()
  })

  test('S10-15: the menu holds "Rename", "Fork", "Archive" and "Delete", with icons, "Coming soon" and the shortcut letters', async ({ chat }) => {
    const check = 'S10-15'
    const page = await startedSession(chat, check)
    await openMenu(page, check)

    const labels = ['Rename', 'Fork', 'Archive', 'Delete']
    const items = menuItems(page)
    await expect(items, `${check}: the menu must hold exactly the items ${labels.join(', ')}.`).toHaveCount(labels.length)
    for (const [index, label] of labels.entries()) {
      const item = items.nth(index)
      await expect(item, `${check}: item ${index + 1} of the menu must be "${label}".`).toHaveText(new RegExp(`^\\s*${label}`))
      expect(await item.locator('svg').count(), `${check}: the item "${label}" has no icon.`).toBeGreaterThan(0)
    }

    for (const label of ['Fork', 'Archive']) {
      await expect(menuItem(page, label), `${check}: the item "${label}" must be disabled.`).toBeDisabled()
      await expect(menuItem(page, label), `${check}: the item "${label}" must show "Coming soon".`).toContainText('Coming soon')
    }
    for (const [label, key] of [
      ['Rename', 'R'],
      ['Delete', 'D']
    ] as const) {
      await expect(menuItem(page, label), `${check}: the item "${label}" must be enabled.`).toBeEnabled()
      await expect(menuItem(page, label).getByText(key, { exact: true }), `${check}: the item "${label}" does not show its shortcut letter "${key}".`).toBeVisible()
    }
  })
})
