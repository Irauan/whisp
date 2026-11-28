// Rename of a session, story S10 of milestone m1-chat, on the built app.
//
// Spec `s10-session-title.md`, "Header layout", item 1 of the menu: "Rename" turns the title into a
// text field in place. Enter saves, Escape cancels. A blank title is refused (the field stays).
// "Data": a rename sets the source `user`, and a title from the agent never replaces a title with
// the source `user` (open choice 1, B).
//
// S10-14: the user renames the session to "My name". The title is "My name" in the strip and the
//         sidebar, also after a restart. A later title "Agent name" of the agent changes nothing.
//         Escape in the field keeps the old title. A blank title is refused.
//
// `fixture.ts` describes the UI contract. No test sleeps.
import {
  chooseItem,
  DRAFT_IN_REPO_A,
  expect,
  expectInTranscript,
  expectTitle,
  renameField,
  restartAndOpen,
  send,
  sessionEntry,
  startImported,
  startSession,
  stopButton,
  test,
  titleHeading,
  titleUpdate,
  writeOldProfile
} from './fixture'

test.describe('S10: Rename', () => {
  test('S10-14: Rename saves the title "My name", Escape keeps the old title, a blank title is refused, and a later title of the agent changes nothing', async ({
    chat
  }) => {
    const check = 'S10-14'
    const prompt = 'Say hello'
    await chat.control.scenario('steps', { prompt: [{ do: 'say', text: 'Hello.' }] })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    let page = await startImported(chat)
    await startSession(page, prompt, check)
    await expectInTranscript(page, 'Hello.', `${check}: the reply does not show.`)
    await expect(stopButton(page), `${check}: the turn does not end.`).toHaveCount(0)

    // Escape in the field keeps the old title.
    await chooseItem(page, 'Rename', check)
    const field = renameField(page)
    await expect(field, `${check}: "Rename" does not turn the title into the text field "Session title".`).toBeVisible()
    await expect(field, `${check}: the text field of Rename must start with the title.`).toHaveValue(prompt)
    await field.fill('Not this name')
    await field.press('Escape')
    await expect(field, `${check}: Escape does not close the text field of Rename.`).toBeHidden()
    await expectTitle(page, prompt, `${check} (Escape keeps the old title)`)
    await expect(sessionEntry(page, 'Not this name'), `${check}: Escape saved the typed title.`).toHaveCount(0)

    // A blank title is refused: the field stays.
    await chooseItem(page, 'Rename', check)
    await expect(field, `${check}: "Rename" does not open the text field "Session title" a second time.`).toBeVisible()
    await field.fill('   ')
    await field.press('Enter')
    await expect(field, `${check}: a blank title must be refused, so the text field must stay.`).toBeVisible()
    await expect(sessionEntry(page, prompt), `${check}: a blank title changed the title in the sidebar.`).toBeVisible()

    // Enter saves the title.
    await field.fill('My name')
    await field.press('Enter')
    await expect(field, `${check}: Enter does not close the text field of Rename.`).toBeHidden()
    await expectTitle(page, 'My name', `${check} (after Rename)`)
    await expect(sessionEntry(page, prompt), `${check}: the sidebar still shows the old title after Rename.`).toHaveCount(0)

    // The agent sends a title in the next turn. The reply after it shows that the title came.
    await chat.control.scenario('steps', { prompt: [titleUpdate('Agent name'), { do: 'say', text: 'Second reply.' }] })
    await send(page, 'Next message', check)
    await expectInTranscript(page, 'Second reply.', `${check}: the reply after the title of the agent does not show.`)
    await expect(stopButton(page), `${check}: the second turn does not end.`).toHaveCount(0)
    await expectTitle(page, 'My name', `${check} (a title of the agent after Rename)`)
    await expect(sessionEntry(page, 'Agent name'), `${check}: the title of the agent replaced the title that the user typed.`).toHaveCount(0)

    // The title of the user is saved: a restart shows it.
    page = await restartAndOpen(chat, 'My name', check)
    await expect(titleHeading(page), `${check}: after a restart, the session window does not show the title "My name".`).toHaveText('My name')
    await chat.stop()

    const data = await chat.readDatabase()
    const rows = data.rowsOf('sessions').filter((row) => row.values.prompt === prompt)
    expect(rows, `${check}: the database must hold one session with the prompt "${prompt}".\n${data.describe()}`).toHaveLength(1)
    expect(rows[0]!.values.title, `${check}: the database must save the title "My name".\n${data.describe()}`).toBe('My name')
  })
})
