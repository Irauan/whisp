// The long slash menu, story S1 of milestone m2-slash-menu, on the built app.
//
// B5: the agent sends 30 commands. The user opens the menu and presses Down 12 times. At most 9 rows
//     show. The selected row is in view. Hover selects a row, and a click inserts it.
//
// "At most 9 rows show": at most 9 rows lie fully inside the visible area of the menu, and the menu
// is at most 300 px high (spec, "Screens"). A 10th row can show in part. `fixture.ts` describes the
// UI contract. No test sleeps.
import {
  commandMenu,
  commandTag,
  expect,
  expectRows,
  expectSelected,
  menuRows,
  openMenu,
  promptField,
  REPLY_CHUNKS,
  startAether,
  startRunningSession,
  test,
  visibleRows,
  type AcpCommand
} from './fixture'

/** 30 fake commands, as in the mockup: skill-01 to skill-30. */
const THIRTY: AcpCommand[] = Array.from({ length: 30 }, (_, index) => {
  const number = String(index + 1).padStart(2, '0')
  return { name: `skill-${number}`, description: `Fake skill number ${index + 1}.`, input: null }
})

test.describe('S1: a long menu scrolls and keeps the selected row in view', () => {
  test('B5: with 30 commands, at most 9 rows show, Down 12 times keeps row 13 in view, hover selects a row and a click inserts it', async ({ chat }) => {
    const check = 'B5'
    await chat.control.scenario('commands', { commands: THIRTY, chunks: REPLY_CHUNKS })
    const page = await startAether(chat)
    await startRunningSession(chat, page, check)

    await openMenu(page, check)
    await expectRows(
      page,
      THIRTY.map((command) => command.name),
      check
    )
    await expectSelected(page, 'skill-01', check)
    const first = await visibleRows(page)
    expect(first.visible.length, `${check}: at most 9 rows may show fully in the menu; ${first.visible.length} do.`).toBeLessThanOrEqual(9)
    expect(first.visible.length, `${check}: the menu must show rows.`).toBeGreaterThan(0)
    expect(first.scrolls, `${check}: the menu with 30 rows must scroll.`).toBe(true)
    expect(first.height, `${check}: the menu must be at most 300 px high.`).toBeLessThanOrEqual(300.5)

    for (let press = 0; press < 12; press++) await page.keyboard.press('ArrowDown')
    await expectSelected(page, 'skill-13', check)
    await expect
      .poll(async () => (await visibleRows(page)).visible.includes(12), { message: `${check}: after Down 12 times, the selected row 13 must be fully in view.` })
      .toBe(true)
    const after = await visibleRows(page)
    expect(after.visible.length, `${check}: at most 9 rows may show fully in the menu after the scroll; ${after.visible.length} do.`).toBeLessThanOrEqual(9)

    // Hover selects a row: a row in view that is not selected.
    const target = after.visible.find((index) => index !== after.selected)
    if (target === undefined) throw new Error(`${check}: the menu shows no other row in view.`)
    const name = THIRTY[target]!.name
    await menuRows(page).nth(target).hover()
    await expectSelected(page, name, `${check} (hover)`)

    // A click inserts it.
    await menuRows(page).nth(target).click()
    await expect(commandMenu(page), `${check}: the menu must close after a click on a row.`).toHaveCount(0)
    await expect(commandTag(promptField(page), name).first(), `${check}: a click on "/${name}" must insert its tag in "Prompt".`).toBeVisible()
  })
})
