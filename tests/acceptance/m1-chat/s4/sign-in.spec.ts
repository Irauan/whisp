// A8 of milestone m1-chat, on the built app.
//
// A8: the agent answers "auth required". The user sends a message. "Claude Code is not signed
// in." and the sign-in steps show. Aether does not crash.
// States table, Not signed in: "Claude Code is not signed in." and the sign-in steps of the profile.
//
// "Aether does not crash" is read as: the window stays, the composer is ready, and the next
// message gets a reply once the agent answers again.
// No test sleeps. Each wait is an auto-waiting check of Playwright, or a report of the agent.
import {
  alerts,
  DRAFT_IN_REPO_A,
  expect,
  expectInTranscript,
  expectReady,
  send,
  startImported,
  startSession,
  test,
  writeOldProfile
} from './fixture'

const NOT_SIGNED_IN = 'Claude Code is not signed in.'

test.describe('A8: a missing sign-in shows a notice with the sign-in steps', () => {
  test('A8: "auth required" shows "Claude Code is not signed in." and the sign-in steps, and Aether goes on', async ({ chat }) => {
    await chat.control.scenario('sign-in-error')
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    await startSession(page, 'Say hello', 'A8')
    await expect.poll(() => chat.control.received('session/prompt').length, { message: 'A8: the agent got no prompt.' }).toBe(1)

    const notice = alerts(page).filter({ hasText: NOT_SIGNED_IN })
    await expect(notice, `A8: no notice in the session window says "${NOT_SIGNED_IN}"`).toBeVisible()
    // The sign-in steps follow the sentence in the same notice.
    await expect(notice, 'A8: the notice shows no sign-in steps after the sentence.').toHaveText(/Claude Code is not signed in\.\s*\S[\s\S]{10,}/)

    // Aether does not crash: the composer is ready, and a later message gets its reply.
    await expectReady(page, 'A8')
    await chat.control.scenario('text', { chunks: ['Hello ', 'from the agent.'] })
    await send(page, 'Say hello again', 'A8')
    await expectInTranscript(page, 'Hello from the agent.', 'A8: after the notice, the next message gets no reply.')
  })
})
