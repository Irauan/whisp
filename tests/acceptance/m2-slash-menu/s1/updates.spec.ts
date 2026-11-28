// The slash menu follows the list of the agent, story S1 of milestone m2-slash-menu, on the built app.
//
// B6: the menu of B1 is open. The agent sends a new `available_commands_update` with `deploy` added.
//     The open menu shows `deploy` without a reopen. The selection keeps its name (spec rule 22).
// S1-7 (spec level "Unit (renderer)", here at acceptance level: the spec names no renderer function
//     for it): the selected row is `compact`, and a new list without `compact` comes. The selection
//     moves to the first row.
// B7: the agent has not sent a list yet, and no last list exists. "/" shows "Loading commands…".
//     When the list comes, the rows replace it. A filter that matches nothing shows
//     "No command matches /<text>.".
// S1-9: the menu shows no match for "/zzz". Enter sends "/zzz" as plain text.
//
// `fixture.ts` describes the UI contract. No test sleeps.
import {
  B1_COMMANDS,
  commandMenu,
  commandTag,
  expect,
  expectRows,
  expectSelected,
  LOADING,
  listStep,
  main,
  menuRows,
  nextPromptText,
  noMatch,
  openMenu,
  REPLY_CHUNKS,
  reach,
  startAether,
  startRunningSession,
  stopButton,
  test,
  transcript,
  typeInComposer,
  type AcpCommand
} from './fixture'

const DEPLOY: AcpCommand = { name: 'deploy', description: 'Deploy the fake app to the test stage.', input: null }
const names = (commands: AcpCommand[]) => commands.map((command) => command.name)

test.describe('S1: the open menu follows the list of the agent', () => {
  test('B6 and S1-7: a new list with deploy shows in the open menu and keeps the selection; a list without the selected row moves the selection to the first row', async ({
    chat
  }) => {
    const check = 'B6'
    const withDeploy = [...B1_COMMANDS, DEPLOY]
    const withoutCompact = withDeploy.filter((command) => command.name !== 'compact')
    await chat.control.scenario('steps', {
      prompt: REPLY_CHUNKS.map((text) => ({ do: 'say', text })),
      afterSession: [listStep(B1_COMMANDS), { do: 'gate', name: 'add-deploy' }, listStep(withDeploy), { do: 'gate', name: 'drop-compact' }, listStep(withoutCompact)]
    })
    const page = await startAether(chat)
    await startRunningSession(chat, page, check)
    await reach(chat.control.waitForGate('add-deploy'), `${check}: the agent did not send its first list.`)

    await openMenu(page, check)
    await expectRows(page, names(B1_COMMANDS), check)
    await page.keyboard.press('ArrowDown')
    await expectSelected(page, 'compact', check)

    await chat.control.open('add-deploy')
    await expectRows(page, names(withDeploy), `${check} (the open menu after the new list)`)
    await expect(commandMenu(page), `${check}: the menu must stay open.`).toBeVisible()
    await expectSelected(page, 'compact', `${check} (rule 22: the selection keeps its name)`)

    await chat.control.open('drop-compact')
    await expectRows(page, names(withoutCompact), 'S1-7 (the open menu after a list without "compact")')
    await expectSelected(page, 'review', 'S1-7 (the selection moves to the first row)')
  })

  test('B7 and S1-9: "Loading commands…" shows until the list comes, the rows replace it, "/zzz" shows no match, and Enter then sends "/zzz"', async ({ chat }) => {
    const check = 'B7'
    await chat.control.scenario('commands', { commands: B1_COMMANDS, gate: 'list', chunks: REPLY_CHUNKS })
    const page = await startAether(chat)
    await startRunningSession(chat, page, check)
    await reach(chat.control.waitForGate('list'), `${check}: the agent did not reach the gate of its list.`)

    await openMenu(page, check)
    await expect(main(page).getByText(LOADING, { exact: true }), `${check}: the menu must show "${LOADING}" before the agent sends its list.`).toBeVisible()
    await expect(menuRows(page), `${check}: the menu must show no row before the list comes.`).toHaveCount(0)

    await chat.control.open('list')
    await expectRows(page, names(B1_COMMANDS), `${check} (the rows replace the loading text)`)
    await expect(main(page).getByText(LOADING, { exact: true }), `${check}: "${LOADING}" must go when the rows show.`).toHaveCount(0)

    await typeInComposer(page, 'zzz', check)
    await expect(main(page).getByText(noMatch('zzz'), { exact: true }), `${check}: "/zzz" must show "${noMatch('zzz')}".`).toBeVisible()
    await expect(menuRows(page), `${check}: "/zzz" must show no row.`).toHaveCount(0)

    // S1-9: with no row to select, Enter sends the text as it is.
    await page.keyboard.press('Enter')
    expect(await nextPromptText(chat, 'S1-9'), 'S1-9: Enter with no match must send "/zzz" as plain text.').toBe('/zzz')
    await expect(stopButton(page), 'S1-9: the turn of "/zzz" does not end.').toHaveCount(0)
    await expect(transcript(page).getByText('/zzz', { exact: true }), 'S1-9: the transcript must show "/zzz" as plain text.').toBeVisible()
    await expect(commandTag(transcript(page), 'zzz'), 'S1-9: a typed "/zzz" without a pick must not become a tag.').toHaveCount(0)
  })
})
