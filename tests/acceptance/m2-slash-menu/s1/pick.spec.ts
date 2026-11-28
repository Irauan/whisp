// A pick in the slash menu becomes a command tag, story S1 of milestone m2-slash-menu, on the built app.
//
// B2 and S1-5: the user types "/co", presses Down and Enter, types "now", and sends. The tag
//     "compact" is at the start of the text, and "now" follows it. The agent receives the prompt
//     "/compact now". The transcript shows the same tag. The saved user entry has `command: compact`
//     and the text "/compact now", and the transcript shows the tag after a restart.
// S1-8: Enter in a menu with rows inserts the row and sends nothing.
// S1-10: a tag "review" with the hint "[pr]" and no text after it shows "[pr]" as the placeholder.
//     One Backspace removes the tag.
// S1-11 (spec level "Unit (renderer)", here at acceptance level: the spec names no renderer function
//     for it): with a tag in place, "/" opens no menu.
//
// `fixture.ts` describes the UI contract. No test sleeps.
import {
  B1_COMMANDS,
  commandMenu,
  commandTag,
  composerText,
  expect,
  expectComposerText,
  expectRows,
  expectSelected,
  FIRST_MESSAGE,
  main,
  nextPromptText,
  openMenu,
  promptField,
  REPLY_CHUNKS,
  restartAndOpen,
  sendButton,
  startAether,
  startRunningSession,
  stopButton,
  test,
  transcript,
  typeInComposer,
  userEntries
} from './fixture'

test.describe('S1: a picked command becomes a tag at the start of the text', () => {
  test('B2, S1-5 and S1-8: "/co", Down and Enter give the tag "compact"; "now" follows it; the agent gets "/compact now"; the entry saves the command and shows the tag after a restart', async ({
    chat
  }) => {
    const check = 'B2'
    await chat.control.scenario('commands', { commands: B1_COMMANDS, chunks: REPLY_CHUNKS })
    let page = await startAether(chat)
    await startRunningSession(chat, page, check)

    await openMenu(page, check, '/co')
    await expectRows(page, ['compact'], check)
    await page.keyboard.press('ArrowDown')
    await expectSelected(page, 'compact', `${check} (Down wraps in a menu of one row)`)
    await page.keyboard.press('Enter')

    // S1-8: Enter inserts the row. It sends nothing.
    const field = promptField(page)
    await expect(commandMenu(page), `${check}: the menu must close after the pick.`).toHaveCount(0)
    await expect(commandTag(field, 'compact').first(), `S1-8: Enter in the menu must insert the tag "compact" in "Prompt".`).toBeVisible()
    await expect(stopButton(page), 'S1-8: Enter in the menu with rows must not send the message.').toHaveCount(0)
    expect(chat.control.received('session/prompt'), 'S1-8: Enter in the menu with rows must not send the message.').toHaveLength(1)
    await expectComposerText(page, /^\s*compact\s*$/, `${check}: after the pick, "Prompt" must hold only the tag "compact", with no "/".`)

    // The text after the tag.
    await page.keyboard.type('now')
    // The text of "Prompt" is in the order of the screen: the tag first, then "now".
    await expectComposerText(page, /^\s*compact\s*now\s*$/, `${check}: the tag "compact" must be at the start of "Prompt", and "now" must follow it.`)

    await expect(sendButton(page), `${check}: "Send" must be enabled with the tag and "now".`).toBeEnabled()
    await sendButton(page).click()
    expect(await nextPromptText(chat, check), `${check}: the agent must receive the prompt "/compact now" as plain text.`).toBe('/compact now')
    await expect(stopButton(page), `${check}: the second turn does not end.`).toHaveCount(0)
    await expect.poll(() => composerText(field), { message: `${check}: "Prompt" must be empty after the send.` }).toMatch(/^\s*$/)

    // The transcript shows the same tag, then "now".
    const log = transcript(page)
    await expect(commandTag(log, 'compact').first(), `${check}: the user entry of the transcript must show the tag "compact".`).toBeVisible()
    await expect(log.getByText('/compact now', { exact: true }), `${check}: the transcript must show the tag, not the plain text "/compact now".`).toHaveCount(0)
    await expect(log, `${check}: the user entry must show "now" after the tag.`).toContainText(/compact\s*now/)

    // S1-5: the tag stays after a restart.
    page = await restartAndOpen(chat, FIRST_MESSAGE, 'S1-5')
    await expect(commandTag(transcript(page), 'compact').first(), 'S1-5: after a restart, the user entry must show the tag "compact".').toBeVisible()
    await chat.stop()

    const data = await chat.readDatabase()
    const users = userEntries(data)
    expect(users, `S1-5: the database must hold two user entries.\n${data.describe()}`).toHaveLength(2)
    expect(users[0], `S1-5: the first user entry holds the first message.`).toMatchObject({ kind: 'user', text: FIRST_MESSAGE })
    expect(users[0]!.command, `S1-5: the first user entry has no command: it had no pick.`).toBeUndefined()
    expect(users[1], `S1-5: the second user entry must save the text "/compact now" and the command "compact".`).toMatchObject({
      kind: 'user',
      text: '/compact now',
      command: 'compact'
    })
  })

  test('S1-10: the tag "review" with no text after it shows the hint "[pr]" as the placeholder, and one Backspace removes the tag', async ({ chat }) => {
    const check = 'S1-10'
    await chat.control.scenario('commands', { commands: B1_COMMANDS, chunks: REPLY_CHUNKS })
    const page = await startAether(chat)
    await startRunningSession(chat, page, check)

    await openMenu(page, check)
    await expectSelected(page, 'review', check)
    await page.keyboard.press('Tab')
    const field = promptField(page)
    await expect(commandMenu(page), `${check}: Tab must insert the row and close the menu.`).toHaveCount(0)
    await expect(commandTag(field, 'review').first(), `${check}: Tab must insert the tag "review".`).toBeVisible()
    await expect(main(page).getByText('[pr]', { exact: true }), `${check}: with no text after the tag, the hint "[pr]" must show as the placeholder.`).toBeVisible()

    await page.keyboard.press('Backspace')
    await expect(commandTag(field, 'review'), `${check}: one Backspace right after the tag must remove it.`).toHaveCount(0)
    await expectComposerText(page, /^\s*$/, `${check}: "Prompt" must be empty after the Backspace.`)
    await expect(main(page).getByText('[pr]', { exact: true }), `${check}: the placeholder "[pr]" must go with the tag.`).toHaveCount(0)

    // The text is empty again, so "/" opens the menu.
    await openMenu(page, check)
  })

  test('S1-11: with a tag in place, "/" is plain text and opens no menu', async ({ chat }) => {
    const check = 'S1-11'
    await chat.control.scenario('commands', { commands: B1_COMMANDS, chunks: REPLY_CHUNKS })
    const page = await startAether(chat)
    await startRunningSession(chat, page, check)

    // The anchor: "/" opens the menu in this window.
    await openMenu(page, check)
    await page.keyboard.press('Enter')
    const field = promptField(page)
    await expect(commandTag(field, 'review').first(), `${check}: Enter must insert the tag "review".`).toBeVisible()
    await expect(commandMenu(page), `${check}: the menu must close after the pick.`).toHaveCount(0)

    await typeInComposer(page, '/', check)
    await expectComposerText(page, /^\s*review\s*\/$/, `${check}: "/" after the tag must be plain text in "Prompt".`)
    await expect(commandMenu(page), `${check}: with a tag in place, "/" must open no menu.`).toHaveCount(0)
  })
})
