// A13 of milestone m1-chat, on the built app.
//
// A13: the user opens the settings menu. One Mode control shows the five modes. No Tool
// permissions control exists. Worktree and the session attachment show "coming soon" and are
// disabled.
//
// The settings menu is read as the controls of the composer of a new session. The profile has one
// draft, so the composer starts with its folder, an existing plain folder.
// No test sleeps. Each wait is an auto-waiting check of Playwright.
import {
  expect,
  main,
  MODE_LABELS,
  MODE_ORDER,
  modeControl,
  modeMenu,
  startImported,
  startsWith,
  test,
  writeOldProfile,
  chooseMode,
  type Draft
} from './fixture'

const DRAFTS: Draft[] = [{ prompt: 'Rename the old files', account: 'personal', mode: 'ask', createdAt: '2026-01-01T00:00:00.000Z' }]

test.describe('A13: the settings menu has one Mode control, and Worktree and the session attachment are coming soon', () => {
  test('A13: one Mode control shows the five modes: Ask, Accept edits, Plan, Auto, Approve all', async ({ aether }) => {
    await writeOldProfile(aether, DRAFTS)
    const page = await startImported(aether)

    const control = modeControl(page)
    await expect(control, 'A13: the composer has no button "Mode".').toBeVisible()
    await expect(control, 'A13: the composer must have exactly one Mode control.').toHaveCount(1)
    await control.click()

    const menu = modeMenu(page)
    await expect(menu, 'A13: the button "Mode" opens no group "Mode".').toBeVisible()
    const options = menu.getByRole('button')
    await expect(options, 'A13: the Mode control must show exactly five modes.').toHaveCount(5)
    for (const [index, mode] of MODE_ORDER.entries()) {
      await expect(options.nth(index), `A13: mode ${index + 1} of the Mode control must be "${MODE_LABELS[mode]}".`).toHaveAccessibleName(
        startsWith(MODE_LABELS[mode])
      )
    }
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()

    // Each of the five modes can be chosen, and the control then shows it.
    for (const mode of MODE_ORDER) {
      await chooseMode(page, mode, 'A13')
      await control.click()
      await expect(
        menu.getByRole('button', { name: startsWith(MODE_LABELS[mode]) }),
        `A13: the menu "Mode" does not mark "${MODE_LABELS[mode]}" as the current mode.`
      ).toHaveAttribute('aria-pressed', 'true')
      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
    }
  })

  test('A13: no Tool permissions control exists', async ({ aether }) => {
    await writeOldProfile(aether, DRAFTS)
    const page = await startImported(aether)
    await expect(main(page).getByRole('textbox', { name: 'Prompt', exact: true })).toBeVisible()

    // Also the hidden content of the closed menus counts.
    await expect(page.getByText(/tool permissions/i), 'A13: a text "Tool permissions" exists.').toHaveCount(0)
    for (const role of ['button', 'group'] as const) {
      await expect(
        page.getByRole(role, { name: /tool permissions/i, includeHidden: true }),
        `A13: a ${role} "Tool permissions" exists.`
      ).toHaveCount(0)
    }

    // The open Mode menu holds the modes only.
    await expect(modeControl(page), 'A13: the composer has no button "Mode".').toBeVisible()
    await modeControl(page).click()
    await expect(modeMenu(page), 'A13: the button "Mode" opens no group "Mode".').toBeVisible()
    await expect(page.getByText(/tool permissions/i), 'A13: the menu "Mode" shows "Tool permissions".').toHaveCount(0)
  })

  test('A13: Worktree shows "coming soon" and is disabled', async ({ aether }) => {
    await writeOldProfile(aether, DRAFTS)
    const page = await startImported(aether)
    await expect(main(page).getByRole('textbox', { name: 'Prompt', exact: true })).toBeVisible()

    const worktree = main(page).getByRole('button', { name: /^Worktree\b.*coming soon/i })
    await expect(worktree, 'A13: no button "Worktree" shows "coming soon".').toBeVisible()
    await expect(worktree, 'A13: the button "Worktree" is not disabled.').toBeDisabled()
  })

  test('A13: the session attachment shows "coming soon" and is disabled', async ({ aether }) => {
    await writeOldProfile(aether, DRAFTS)
    const page = await startImported(aether)

    const add = main(page).getByRole('button', { name: 'Add context', exact: true })
    await expect(add, 'A13: the composer has no button "Add context".').toBeVisible()
    await add.click()
    const menu = page.getByRole('group', { name: 'Add context', exact: true })
    await expect(menu, 'A13: the button "Add context" opens no group "Add context".').toBeVisible()

    const session = menu.getByRole('button', { name: /^Session/ })
    await expect(session, 'A13: the menu "Add context" has no session attachment.').toBeVisible()
    await expect(session, 'A13: the session attachment does not show "coming soon".').toHaveAccessibleName(/coming soon/i)
    await expect(session, 'A13: the session attachment is not disabled.').toBeDisabled()
  })
})
