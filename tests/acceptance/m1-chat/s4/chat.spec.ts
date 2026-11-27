// A1, A2 and A3 of milestone m1-chat, and G11 and G12 of m0-gates, on the built app.
//
// A1: profile "Personal" with workspace directory R and the folder R/repo-a. The user creates a
// session in R/repo-a with "Say hello". The reply streams into the session window. The entries
// are saved.
// A2: A1 is done. The user sends "Say it again". The reply comes in the same agent session.
// A3: a long reply streams and a tool call is open. The user clicks Stop. "Stopped." shows, the
// tool call shows failed, and the composer is ready.
// G11 and G12 (user decision, 2026-11-26: the S4 tests replace them): the app runs in a temporary
// data folder, and the real data folder is untouched before and after. "Working" shows while the
// agent waits at a gate, then the reply after the gate opens.
//
// The fixture describes the UI contract and the reading of "trusted" in S4.
// No test sleeps. Each wait is an auto-waiting check of Playwright, or a report of the agent.
import {
  cwdOf,
  DRAFT_IN_REPO_A,
  expect,
  expectInTranscript,
  expectReady,
  folderPath,
  holds,
  main,
  modesOf,
  reach,
  realDataDir,
  samePath,
  send,
  sessionIdOf,
  startImported,
  startSession,
  stopButton,
  test,
  toolCall,
  transcript,
  working,
  writeOldProfile
} from './fixture'

test.describe('A1, A2, A3, G11 and G12: chat in a session', () => {
  test('A1 and G11: the reply to "Say hello" streams into the session window in R/repo-a, the entries are saved, and the app runs in a temporary data folder', async ({
    chat
  }) => {
    // The reply comes in two chunks, with a gate between them.
    await chat.control.scenario('steps', {
      prompt: [
        { do: 'say', text: 'Hello ' },
        { do: 'gate', name: 'rest' },
        { do: 'say', text: 'from the agent.' }
      ]
    })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)

    // The composer of a new session starts with the folder of the last session, R/repo-a.
    await startSession(page, 'Say hello', 'A1')
    await expectInTranscript(page, 'Say hello', 'A1: the transcript does not show the message "Say hello" of the user.')

    // The first chunk shows before the agent sends the second one: the reply streams.
    await reach(chat.control.waitForGate('rest'), 'A1: the agent did not get the prompt, so no agent reply can come.')
    await expectInTranscript(page, 'Hello', 'A1: the first chunk "Hello " of the reply does not show while the agent waits, so the reply does not stream.')
    await chat.control.open('rest')
    await expectInTranscript(page, 'Hello from the agent.', 'A1: the session window does not show the whole reply "Hello from the agent.".')
    await expectReady(page, 'A1')

    // The agent session runs in R/repo-a and got the prompt.
    const created = chat.control.received('session/new')
    expect(created, 'A1: the agent must get one session/new.').toHaveLength(1)
    expect(samePath(cwdOf(created[0]!), folderPath(chat, 'repo-a')), `A1: the agent session must run in ${folderPath(chat, 'repo-a')}.`).toBe(true)
    expect(chat.control.received('session/prompt')[0]?.params, 'A1: the agent must get "Say hello".').toMatchObject({
      prompt: [{ type: 'text', text: 'Say hello' }]
    })

    // G11: the app runs in the temporary data folder, not in the real one.
    const userData = await chat.app.evaluate(({ app }) => app.getPath('userData'))
    expect(samePath(userData, chat.dataDir), 'G11: the app must use the temporary data folder.').toBe(true)
    expect(samePath(userData, realDataDir()), 'G11: the app must not use the real data folder.').toBe(false)

    // The entries are saved, in the database of the temporary folder. Streamed text is joined first.
    await chat.stop()
    const data = await chat.readDatabase()
    const dump = `The database holds:\n${data.describe()}`
    const entries = (text: string) => data.holding(text).filter((row) => modesOf(row).length === 0)
    expect(entries('Say hello'), `A1: no saved entry holds the message "Say hello" of the user.\n${dump}`).not.toHaveLength(0)
    expect(entries('Hello from the agent.'), `A1: no saved entry holds the joined reply "Hello from the agent.".\n${dump}`).not.toHaveLength(0)
    expect(data.holding('from the agent.'), `A1: a saved entry holds a chunk of the reply, so the text was not joined.\n${dump}`).toHaveLength(0)
    expect(data.rows.some((row) => holds(row, 'Hello ')), `A1: a saved entry holds a chunk of the reply, so the text was not joined.\n${dump}`).toBe(false)
    // The fixture checks the real folder before the first start and after the exit (G11).
  })

  test('G12: the app shows "Working" while the agent waits at a gate, and the reply after the gate opens', async ({ chat }) => {
    await chat.control.scenario('text', { gate: 'reply' })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    await startSession(page, 'Say hello', 'G12')

    // The agent reported the gate before it waited, so it cannot have replied yet.
    await reach(chat.control.waitForGate('reply'), 'G12: the agent did not get the prompt, so it never reached the gate.')
    await expect(working(page), 'G12: "Working" does not show while the agent waits at the gate.').toBeVisible()
    await expect(transcript(page).getByText('Hello', { exact: true }), 'G12: a reply shows before the gate opened.').toHaveCount(0)

    await chat.control.open('reply')
    await expectInTranscript(page, 'Hello', 'G12: the reply "Hello" does not show after the gate opened.')
    await expect(working(page), 'G12: "Working" still shows after the reply.').toBeHidden()
  })

  test('A2: "Say it again" gets its reply in the same agent session', async ({ chat }) => {
    await chat.control.scenario('text', { chunks: ['Hello ', 'from the agent.'] })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    await startSession(page, 'Say hello', 'A2')
    await expectInTranscript(page, 'Hello from the agent.', 'A2: the first reply "Hello from the agent." does not show.')
    await expectReady(page, 'A2')

    await chat.control.scenario('text', { chunks: ['Hello ', 'again.'] })
    await send(page, 'Say it again', 'A2')
    await expectInTranscript(page, 'Say it again', 'A2: the transcript does not show the message "Say it again".')
    await expectInTranscript(page, 'Hello again.', 'A2: the reply "Hello again." to "Say it again" does not show.')
    await expect(transcript(page), 'A2: the transcript must show both turns, in order.').toHaveText(
      /Say hello[\s\S]*Hello from the agent\.[\s\S]*Say it again[\s\S]*Hello again\./
    )

    // The same agent session, in the same agent process.
    await expect.poll(() => chat.control.received('session/prompt').length, { message: 'A2: the agent must get two prompts.' }).toBe(2)
    const prompts = chat.control.receivedBy('session/prompt')
    expect(prompts[1]!.message.params, 'A2: the second prompt must be "Say it again".').toMatchObject({
      prompt: [{ type: 'text', text: 'Say it again' }]
    })
    expect(sessionIdOf(prompts[1]!.message), 'A2: the second prompt must go to the same agent session as the first.').toBe(
      sessionIdOf(prompts[0]!.message)
    )
    expect(chat.control.received('session/new'), 'A2: the second message must not create a new agent session.').toHaveLength(1)
    expect(chat.control.pids, 'A2: the second message must not start a new agent process.').toHaveLength(1)
    expect(prompts[1]!.pid, 'A2: the second prompt must reach the process of the first.').toBe(prompts[0]!.pid)
  })

  test('A3: Stop during a long reply with an open tool call shows "Stopped.", the tool call failed, and a ready composer', async ({
    chat
  }) => {
    const tool = 'Run the test suite'
    await chat.control.scenario('steps', {
      prompt: [
        { do: 'say', text: 'This is the first part of a long reply.' },
        { do: 'update', update: { sessionUpdate: 'tool_call', toolCallId: 'run-tests', title: tool, kind: 'execute', status: 'in_progress' } },
        { do: 'say', text: ' The tests still run.' },
        // The test never opens this gate. Only a cancel ends the turn.
        { do: 'gate', name: 'never' }
      ]
    })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    await startSession(page, 'Write a long answer', 'A3')

    await reach(chat.control.waitForGate('never'), 'A3: the agent did not get the prompt, so no reply streams.')
    await expect(transcript(page), 'A3: the long reply does not stream into the transcript.').toContainText('The tests still run.')
    await expect(toolCall(page, tool), `A3: the transcript does not show the open tool call "${tool}".`).toBeVisible()
    await expect(toolCall(page, tool), 'A3: the tool call shows failed before the user clicked Stop.').not.toContainText('Failed')
    await expect(stopButton(page), 'A3: the button "Stop" does not show while the reply streams.').toBeEnabled()

    await stopButton(page).click()
    await expect
      .poll(() => chat.control.received('session/cancel').length, { message: 'A3: Stop did not send session/cancel to the agent.' })
      .toBe(1)
    expect(sessionIdOf(chat.control.received('session/cancel')[0]!), 'A3: the cancel must name the agent session of the turn.').toBe(
      sessionIdOf(chat.control.received('session/prompt')[0]!)
    )
    await expect(main(page).getByText('Stopped.', { exact: true }), 'A3: "Stopped." does not show after Stop.').toBeVisible()
    await expect(toolCall(page, tool), 'A3: the open tool call does not show failed after Stop.').toContainText('Failed')
    await expect(transcript(page), 'A3: the streamed part of the reply is gone after Stop.').toContainText('This is the first part of a long reply.')
    await expectReady(page, 'A3')
  })
})
