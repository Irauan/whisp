// The reply composer keeps its role and name, story S1 of milestone m2-slash-menu, on the built app.
//
// S1-12 (regression): the m1-chat tests that `fill` the reply composer find it by its role and its
// name, as before. The text area of the reply composer becomes an editor with inline tokens (spec,
// open choice 6), and it keeps the role `textbox` and the name "Prompt".
//
// This test passes before the story is built, on purpose: it guards the old behavior. It fills the
// composer with `fill`, as the m1-chat tests do, sends, and checks the text that the agent gets.
// `fixture.ts` describes the UI contract. No test sleeps.
import {
  B1_COMMANDS,
  composerText,
  expect,
  main,
  nextPromptText,
  promptField,
  REPLY_CHUNKS,
  sendButton,
  startAether,
  startRunningSession,
  stopButton,
  test,
  transcript
} from './fixture'

test.describe('S1: the reply composer stays the textbox "Prompt"', () => {
  test('S1-12: fill on the textbox "Prompt" of the reply composer, then Send, gives the agent the text', async ({ chat }) => {
    const check = 'S1-12'
    await chat.control.scenario('commands', { commands: B1_COMMANDS, chunks: REPLY_CHUNKS })
    const page = await startAether(chat)
    await startRunningSession(chat, page, check)

    const field = main(page).getByRole('textbox', { name: 'Prompt', exact: true })
    await expect(field, `${check}: the session window must have one textbox named exactly "Prompt".`).toHaveCount(1)
    await expect(field, `${check}: the textbox "Prompt" must take text.`).toBeEditable()
    await field.fill('A first draft')
    await field.fill('')
    await expect.poll(() => composerText(promptField(page)), { message: `${check}: fill("") must empty "Prompt".` }).toMatch(/^\s*$/)
    await field.fill('Check the fake build log')
    await expect(sendButton(page), `${check}: "Send" must be enabled after fill.`).toBeEnabled()
    await sendButton(page).click()
    expect(await nextPromptText(chat, check), `${check}: the agent must get the text that fill wrote.`).toBe('Check the fake build log')
    await expect(stopButton(page), `${check}: the turn does not end.`).toHaveCount(0)
    await expect(transcript(page).getByText('Check the fake build log', { exact: true }), `${check}: the transcript must show the message.`).toBeVisible()
  })
})
