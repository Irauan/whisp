// A6 and A20 of milestone m1-chat, on the built app: a new agent process resumes the agent session.
//
// A6: a session with two turns. The user quits and starts Aether, opens the session, and sends a
// message. The transcript shows both turns. The agent resumes the same session.
// A20: the agent process exits during a turn. An error notice shows the exit code. The next
// message starts a new process and resumes.
// States table, Agent stopped: an error notice with the exit code and the last log lines.
//
// Each process of the simulated agent counts its session IDs from `s1`. An equal session ID alone
// proves nothing, so the tests check that the new process got `session/resume` or `session/load`
// with the earlier ID, and no `session/new`.
// No test sleeps. Each wait is an auto-waiting check of Playwright, or a report of the agent.
import {
  alerts,
  DRAFT_IN_REPO_A,
  expect,
  expectInTranscript,
  expectReady,
  inOrder,
  ofProcess,
  send,
  sessionEntry,
  sessionIdOf,
  startImported,
  startSession,
  test,
  transcript,
  writeOldProfile,
  type ChatApp
} from './fixture'

/** Checks that a new agent process resumed the agent session of the first prompt, and got the last prompt in it. */
async function expectResumed(chat: ChatApp, check: string, lastPrompt: string): Promise<void> {
  const { control } = chat
  await expect.poll(() => control.pids.length, { message: `${check}: the next message did not start a new agent process.` }).toBe(2)
  const [first, second] = control.pids as [number, number]
  await expect
    .poll(() => ofProcess(control.receivedBy('session/prompt'), second).length, {
      message: `${check}: the new agent process got no prompt.`
    })
    .toBe(1)
  const earlier = sessionIdOf(ofProcess(control.receivedBy('session/prompt'), first)[0]!.message)
  expect(earlier, `${check}: the first process got no prompt with a session ID.`).toEqual(expect.any(String))

  const resumes = [...control.receivedBy('session/resume'), ...control.receivedBy('session/load')]
  const resumed = ofProcess(resumes, second).map(({ message }) => sessionIdOf(message))
  expect(resumed, `${check}: the new process must get session/resume or session/load of the agent session ${String(earlier)}.`).toEqual([
    earlier
  ])
  expect(ofProcess(control.receivedBy('session/new'), second), `${check}: the new process must not create a new agent session.`).toHaveLength(0)
  const prompt = ofProcess(control.receivedBy('session/prompt'), second)[0]!.message
  expect(sessionIdOf(prompt), `${check}: the next message must go to the resumed agent session.`).toBe(earlier)
  expect(prompt.params, `${check}: the new process must get the next message "${lastPrompt}".`).toMatchObject({
    prompt: [{ type: 'text', text: lastPrompt }]
  })
}

test.describe('A6 and A20: a new agent process resumes the agent session', () => {
  test('A6: after a restart, the session shows both turns, and the next message resumes the same agent session', async ({ chat }) => {
    await chat.control.scenario('text', { chunks: ['Hello ', 'from the agent.'] })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    let page = await startImported(chat)
    await startSession(page, 'Say hello', 'A6')
    await expectInTranscript(page, 'Hello from the agent.', 'A6: the first reply does not show.')
    await expectReady(page, 'A6')
    await chat.control.scenario('text', { chunks: ['Hello ', 'again.'] })
    await send(page, 'Say it again', 'A6')
    await expectInTranscript(page, 'Hello again.', 'A6: the second reply does not show.')
    await expectReady(page, 'A6')

    // Quit and start Aether. No turn survives the restart, but the conversation does.
    await chat.stop()
    page = await chat.start()
    const entry = sessionEntry(page, 'Say hello')
    await expect(entry, 'A6: after a restart, the sidebar does not list the session "Say hello".').toBeVisible()
    await entry.click()
    await expect(entry).toHaveAttribute('aria-current', 'page')
    await expect(transcript(page), 'A6: after a restart, the transcript must show both turns, in order.').toHaveText(
      inOrder('Say hello', 'Hello from the agent.', 'Say it again', 'Hello again.')
    )

    await chat.control.scenario('text', { chunks: ['Welcome ', 'back.'] })
    await send(page, 'Are you still there?', 'A6')
    await expectInTranscript(page, 'Welcome back.', 'A6: the reply after the restart does not show.')
    await expect(transcript(page), 'A6: the transcript must show all three turns, in order.').toHaveText(
      inOrder('Say hello', 'Hello from the agent.', 'Say it again', 'Hello again.', 'Are you still there?', 'Welcome back.')
    )
    await expectResumed(chat, 'A6', 'Are you still there?')
  })

  test('A20: when the agent process exits during a turn, a notice shows the exit code and the last log lines, and the next message starts a new process that resumes', async ({
    chat
  }) => {
    await chat.control.scenario('text', { chunks: ['Hello ', 'from the agent.'] })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    await startSession(page, 'Say hello', 'A20')
    await expectInTranscript(page, 'Hello from the agent.', 'A20: the first reply does not show.')
    await expectReady(page, 'A20')

    // The process ends with exit code 7 during the next turn. It writes a log line first.
    const logLine = 'simulated agent: the disk is full'
    await chat.control.scenario('crash', { exitCode: 7, log: logLine })
    await send(page, 'Say it again', 'A20')
    await expect.poll(() => chat.control.received('session/prompt').length, { message: 'A20: the agent got no second prompt.' }).toBe(2)
    const notice = alerts(page).filter({ hasText: /exit code:? 7\b/i })
    await expect(notice, 'A20: no error notice in the session window shows the exit code 7.').toBeVisible()
    await expect(notice, 'A20 (Agent stopped): the error notice does not show the last log lines of the agent.').toContainText(logLine)
    await expectReady(page, 'A20')

    // The next message starts a new process, which resumes the agent session.
    await chat.control.scenario('text', { chunks: ['Back ', 'again.'] })
    await send(page, 'Are you back?', 'A20')
    await expectInTranscript(page, 'Back again.', 'A20: the reply of the new agent process does not show.')
    await expectResumed(chat, 'A20', 'Are you back?')
  })
})
