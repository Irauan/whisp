// The slash menu of a running session, story S1 of milestone m2-slash-menu, on the built app.
//
// B1: the user types "/" as the first character. The menu shows the 4 rows of the agent in the agent
//     order, each with the bold name, the hint and the description. The first row is selected.
// B3: the user types "hello /". No menu opens.
// B4: the menu is open with the text "/re". Escape closes it, and the text stays "/re".
// S1-1 (end to end, user decision 2026-11-28 "Hide it"): the agent lists `remote-control`, and the
//     menu does not show it.
//
// `fixture.ts` describes the UI contract. No test sleeps.
import {
  B1_COMMANDS,
  clearComposer,
  commandMenu,
  expect,
  expectComposerText,
  expectRows,
  expectSelected,
  menuRow,
  menuRows,
  noMatch,
  openMenu,
  promptField,
  REPLY_CHUNKS,
  rowName,
  startAether,
  startRunningSession,
  test,
  typeInComposer,
  main
} from './fixture'

const escaped = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')

test.describe('S1: the slash menu opens at the start of the text of a running session', () => {
  test('B1: "/" as the first character shows the 4 commands in the agent order, each with the bold name, the hint and the description; the first row is selected', async ({
    chat
  }) => {
    const check = 'B1'
    await chat.control.scenario('commands', { commands: B1_COMMANDS, chunks: REPLY_CHUNKS })
    const page = await startAether(chat)
    await startRunningSession(chat, page, check)

    await openMenu(page, check)
    await expectRows(
      page,
      B1_COMMANDS.map((command) => command.name),
      check
    )
    await expectSelected(page, 'review', check)
    for (const index of [1, 2, 3]) {
      await expect(menuRows(page).nth(index), `${check}: row ${index + 1} must not be selected: only the first row is.`).toHaveAttribute('aria-selected', 'false')
    }

    for (const command of B1_COMMANDS) {
      const row = menuRow(page, command.name)
      const hint = command.input ? `\\s*${escaped(command.input.hint)}` : ''
      await expect(
        row,
        `${check}: the row "/${command.name}" must show the name, ${command.input ? `then the hint "${command.input.hint}", ` : ''}then the description "${command.description}".`
      ).toHaveText(new RegExp(`^\\s*/${escaped(command.name)}${hint}\\s*${escaped(command.description)}\\s*$`))
      const name = rowName(row, command.name)
      const weight = await name.evaluate((element) => Number((globalThis as unknown as { getComputedStyle(item: unknown): { fontWeight: string } }).getComputedStyle(element).fontWeight))
      expect(weight, `${check}: the name "/${command.name}" must be bold (font weight 600 or more).`).toBeGreaterThanOrEqual(600)
      const colorOf = (locator: typeof name) =>
        locator.evaluate((element) => (globalThis as unknown as { getComputedStyle(item: unknown): { color: string } }).getComputedStyle(element).color)
      const description = row.getByText(command.description, { exact: true })
      await expect(description, `${check}: the description of "/${command.name}" must be an element of its own in the row.`).toBeVisible()
      expect(await colorOf(description), `${check}: the description of "/${command.name}" must be muted: another color than the name.`).not.toBe(
        await colorOf(name)
      )
    }

    // The menu sits above the composer box, at its full width.
    const menuBox = await commandMenu(page).boundingBox()
    const fieldBox = await promptField(page).boundingBox()
    if (!menuBox || !fieldBox) throw new Error(`${check}: the menu or "Prompt" has no box on the screen.`)
    expect(menuBox.y + menuBox.height, `${check}: the menu must sit above "Prompt".`).toBeLessThanOrEqual(fieldBox.y + 1)
    expect(menuBox.width, `${check}: the menu must take the full width of the composer box, at least the width of "Prompt".`).toBeGreaterThanOrEqual(
      fieldBox.width - 1
    )
  })

  test('B3: "hello /" opens no menu', async ({ chat }) => {
    const check = 'B3'
    await chat.control.scenario('commands', { commands: B1_COMMANDS, chunks: REPLY_CHUNKS })
    const page = await startAether(chat)
    await startRunningSession(chat, page, check)

    // The anchor: "/" at the start opens the menu in this window.
    await openMenu(page, check)
    await clearComposer(page, check)
    await expect(commandMenu(page), `${check}: the menu must close when the text is empty.`).toHaveCount(0)

    await typeInComposer(page, 'hello /', check)
    await expectComposerText(page, 'hello /', `${check}: "Prompt" does not hold the typed text "hello /".`)
    await expect(commandMenu(page), `${check}: "/" after other text must open no menu.`).toHaveCount(0)
  })

  test('B4: Escape closes the open menu of "/re", and the text stays "/re"', async ({ chat }) => {
    const check = 'B4'
    await chat.control.scenario('commands', { commands: B1_COMMANDS, chunks: REPLY_CHUNKS })
    const page = await startAether(chat)
    await startRunningSession(chat, page, check)

    await openMenu(page, check, '/re')
    await expectRows(page, ['review'], check)
    await page.keyboard.press('Escape')
    await expect(commandMenu(page), `${check}: Escape must close the menu "Commands".`).toHaveCount(0)
    await expectComposerText(page, '/re', `${check}: Escape must keep the text "/re" in "Prompt".`)
  })

  test('S1-1 (end to end): the menu does not show remote-control, which the agent lists (user decision 2026-11-28)', async ({ chat }) => {
    const check = 'S1-1 (end to end)'
    const list = [
      B1_COMMANDS[0]!,
      { name: 'remote-control', description: 'Let the fake remote app continue this session.', input: null },
      B1_COMMANDS[1]!
    ]
    await chat.control.scenario('commands', { commands: list, chunks: REPLY_CHUNKS })
    const page = await startAether(chat)
    await startRunningSession(chat, page, check)

    await openMenu(page, check)
    await expectRows(page, ['review', 'compact'], check)
    await typeInComposer(page, 'remote', check)
    await expect(main(page).getByText(noMatch('remote'), { exact: true }), `${check}: "/remote" must match no row: "remote-control" is hidden.`).toBeVisible()
    await expect(menuRows(page), `${check}: "/remote" must show no row.`).toHaveCount(0)
  })
})
