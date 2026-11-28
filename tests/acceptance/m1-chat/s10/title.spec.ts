// The session title from the agent, story S10 of milestone m1-chat, on the built app.
//
// Spec `s10-session-title.md`, "Behavior" and "Screens": when the agent reports a title, Aether
// saves it as the title of the session and shows it in the session window and in the sidebar,
// without a restart and without a click. A title can come during a turn or outside a turn.
//
// S10-1: a title during the turn shows in the window and the sidebar, and it stays after a restart.
// S10-2: a title outside a turn (detach behind a gate) shows in the window and the sidebar.
// S10-3: a title of session A shows in the sidebar row of A, while session B is open and does not change.
//
// `fixture.ts` describes the UI contract. No test sleeps.
import {
  DRAFT_IN_REPO_A,
  expect,
  expectInTranscript,
  expectTitle,
  openNewSession,
  reach,
  restartAndOpen,
  sessionEntry,
  startImported,
  startSession,
  stopButton,
  test,
  titleHeading,
  titleUpdate,
  transcript,
  writeOldProfile
} from './fixture'

test.describe('S10: the title that the agent reports becomes the title of the session', () => {
  test('S10-1: a title that the agent sends during the turn shows in the window and the sidebar, and stays after a restart', async ({ chat }) => {
    const check = 'S10-1'
    const prompt = 'Say hello to the team'
    await chat.control.scenario('steps', {
      prompt: [{ do: 'gate', name: 'title' }, titleUpdate('Greeting test'), { do: 'gate', name: 'shown' }, { do: 'say', text: 'Hello, team.' }]
    })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    let page = await startImported(chat)
    await startSession(page, prompt, check)

    // Before the agent sends a title, the first line of the first message is the title.
    await reach(chat.control.waitForGate('title'), `${check}: the agent did not get the first message.`)
    await expectTitle(page, prompt, `${check} (before the title of the agent)`)

    // The agent sends the title and waits at the gate "shown": the turn still runs.
    await chat.control.open('title')
    await reach(chat.control.waitForGate('shown'), `${check}: the agent did not send the title.`)
    await expect(stopButton(page), `${check}: the turn must still run while the agent waits at the gate.`).toBeVisible()
    await expectTitle(page, 'Greeting test', `${check} (during the turn)`)
    await expect(sessionEntry(page, prompt), `${check}: the sidebar still shows the first line as the title.`).toHaveCount(0)

    await chat.control.open('shown')
    await expectInTranscript(page, 'Hello, team.', `${check}: the reply after the title does not show.`)
    await expect(stopButton(page), `${check}: the turn does not end.`).toHaveCount(0)
    await expectTitle(page, 'Greeting test', `${check} (after the turn)`)

    // The title is saved: a restart shows it.
    page = await restartAndOpen(chat, 'Greeting test', check)
    await expect(titleHeading(page), `${check}: after a restart, the session window does not show the title "Greeting test".`).toHaveText('Greeting test')
    await chat.stop()

    const data = await chat.readDatabase()
    const rows = data.rowsOf('sessions').filter((row) => row.values.prompt === prompt)
    expect(rows, `${check}: the database must hold one session with the prompt "${prompt}".\n${data.describe()}`).toHaveLength(1)
    expect(rows[0]!.values.title, `${check}: the database must save the title of the agent.\n${data.describe()}`).toBe('Greeting test')
  })

  test('S10-2: a title that the agent sends outside a turn shows in the window and the sidebar', async ({ chat }) => {
    const check = 'S10-2'
    const prompt = 'Say hello'
    await chat.control.scenario('steps', {
      prompt: [{ do: 'say', text: 'Hello.' }, { do: 'detach', steps: [{ do: 'gate', name: 'late' }, titleUpdate('Late title')] }]
    })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    await startSession(page, prompt, check)
    await expectInTranscript(page, 'Hello.', `${check}: the reply does not show.`)
    await expect(stopButton(page), `${check}: the turn does not end.`).toHaveCount(0)

    // The turn ended. The detached steps wait at the gate "late".
    await reach(chat.control.waitForGate('late'), `${check}: the detached steps of the agent did not start.`)
    await expectTitle(page, prompt, `${check} (before the title of the agent)`)

    await chat.control.open('late')
    await expectTitle(page, 'Late title', `${check} (a title outside a turn)`)
    await expect(sessionEntry(page, prompt), `${check}: the sidebar still shows the first line as the title.`).toHaveCount(0)
    await expect(stopButton(page), `${check}: a title outside a turn must not start a turn.`).toHaveCount(0)
  })

  test('S10-3: the title of session A shows in the sidebar row of A, and the open window of session B does not change', async ({ chat }) => {
    const check = 'S10-3'
    const first = 'Write the release notes'
    const second = 'Fix the login form'
    // Session A: its title comes after its turn, when the test opens the gate "title-a".
    await chat.control.scenario('steps', {
      prompt: [{ do: 'say', text: 'Notes ready.' }, { do: 'detach', steps: [{ do: 'gate', name: 'title-a' }, titleUpdate('Release notes draft')] }]
    })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    await startSession(page, first, check)
    await expectInTranscript(page, 'Notes ready.', `${check}: the reply of session A does not show.`)
    await expect(stopButton(page), `${check}: the turn of session A does not end.`).toHaveCount(0)
    await reach(chat.control.waitForGate('title-a'), `${check}: the detached steps of session A did not start.`)

    // Session B: a new session with its own agent process. It stays open.
    await chat.control.scenario('text', { chunks: ['Hello ', 'from B.'] })
    await openNewSession(page)
    await startSession(page, second, check)
    await expectInTranscript(page, 'Hello from B.', `${check}: the reply of session B does not show.`)
    await expect(stopButton(page), `${check}: the turn of session B does not end.`).toHaveCount(0)

    // The agent of session A sends its title.
    await chat.control.open('title-a')
    await expect(sessionEntry(page, 'Release notes draft'), `${check}: the sidebar row of session A does not show the new title.`).toBeVisible()
    await expect(sessionEntry(page, first), `${check}: the sidebar row of session A still shows the old title.`).toHaveCount(0)

    // The window of session B does not change.
    await expect(sessionEntry(page, second), `${check}: session B is not open any more.`).toHaveAttribute('aria-current', 'page')
    await expect(sessionEntry(page, 'Release notes draft'), `${check}: the title of session A opened session A.`).not.toHaveAttribute('aria-current', 'page')
    await expect(titleHeading(page), `${check}: the window of session B shows another title.`).toHaveText(second)
    await expect(transcript(page), `${check}: the window of session B shows the transcript of session A.`).not.toContainText('Notes ready.')
    await expect(transcript(page), `${check}: the window of session B lost its reply.`).toContainText('Hello from B.')
  })
})
