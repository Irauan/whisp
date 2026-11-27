// S5-28 (the texts after a restart) and S5-31 of milestone m1-chat: cards that closed without an
// answer, on the built app.
//
// S5-28: each path that closes an open card saves its reason: Stop (`stopped`), `$/cancel_request`
// (`withdrawn`), the exit or crash of the process (`exited`), the quit of Aether (`quit`), Skip
// (`skipped`). The card shows the text of its reason after a restart. Delete session saves no entry,
// and the agent gets `cancelled`. The level of S5-28 is a slice test
// (`tests/architecture/m1-chat-s5-permission-queue.test.ts` checks each saved reason). This test
// checks the part that only the window shows: the texts of `withdrawn`, `exited` and `quit` after a
// restart. Stop and Skip have their texts in S5-20 and S5-22.
// S5-31: crash path. A card is open, and the test kills the main process of Aether. At the next
// start, before the window loads, the entry has the outcome `interrupted`. The card shows "Not
// answered: Aether stopped unexpectedly." and no button.
//
// User decision, 2026-11-27 (spec, "Cards that closed without an answer"): "Save the card when it
// opens; at the next start an open one shows 'Not answered: Aether stopped unexpectedly.'". The
// saved entry `answers` (spec, "Data") has the outcome `open` while the card is open.
// `fixture.ts` describes the UI contract and `killApp`. No test sleeps.
import {
  alerts,
  answeredDecisions,
  answersEntries,
  ask,
  DRAFT_IN_REPO_A,
  expect,
  expectReady,
  gate,
  isRunning,
  killApp,
  NOT_ANSWERED,
  openDecision,
  openDecisions,
  QUESTION_OF,
  restartAndOpen,
  send,
  startImported,
  startSession,
  test,
  writeOldProfile,
  type Ask
} from './fixture'

const TITLE = 'Edit the two files'
const EDIT_A: Ask = { id: 'edit-a', title: 'Edit a.txt', kind: 'edit' }
const EDIT_B: Ask = { id: 'edit-b', title: 'Edit b.txt', kind: 'edit' }
const RUN: Ask = { id: 'run-tests', title: 'npm test', kind: 'execute' }

test.describe('S5-28 and S5-31: cards that closed without an answer', () => {
  test('S5-28: a withdrawn card, a card of an agent that exited and a card open at the quit show their reasons, also after a restart', async ({ chat }) => {
    const check = 'S5-28'
    await chat.control.scenario('steps', { prompt: [ask(EDIT_A, EDIT_B), gate('withdraw'), { do: 'withdraw', id: EDIT_A.id }, gate('never')] })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    let page = await startImported(chat)
    await startSession(page, TITLE, check)
    await expect(openDecisions(page), `${check}: the agent asked two permissions, but the log does not show two cards "Permission request".`).toHaveCount(2)

    // Claude withdraws the first request. Only that card closes.
    await chat.control.open('withdraw')
    await expect(
      answeredDecisions(page).filter({ hasText: NOT_ANSWERED.withdrawn }),
      `${check}: the card that Claude withdrew must show "${NOT_ANSWERED.withdrawn}".`
    ).toHaveCount(1)
    await expect(openDecision(page, EDIT_B.title), `${check}: the other card must stay open after the withdraw.`).toHaveCount(1)
    // The spec does not fix what the agent gets for a request that it withdrew, so the test does not read it.

    // The agent process ends with the second card open.
    const [pid] = chat.control.pids as [number]
    process.kill(pid)
    await expect.poll(() => isRunning(pid), { message: `${check}: the agent process does not end.` }).toBe(false)
    await expect(
      answeredDecisions(page).filter({ hasText: NOT_ANSWERED.exited }),
      `${check}: the card that was open when Claude Code exited must show "${NOT_ANSWERED.exited}".`
    ).toHaveCount(1)
    await expect(openDecisions(page), `${check}: a card is still open after the agent process ended.`).toHaveCount(0)
    await expect(alerts(page).first(), `${check}: the end of the agent process shows no error notice.`).toBeVisible()
    await expectReady(page, check)

    // A new turn in a new process, with a card open when Aether quits.
    await chat.control.scenario('steps', { prompt: [ask(RUN), gate('never')] })
    await send(page, 'Run the tests', check)
    await expect(openDecision(page, RUN.title), `${check}: the request of the new turn shows no card.`).toHaveCount(1)
    await chat.stop()

    page = await restartAndOpen(chat, TITLE, check)
    await expect(openDecisions(page), `${check} (after a restart): a card "Permission request" is open again.`).toHaveCount(0)
    for (const [reason, question] of [
      ['withdrawn', QUESTION_OF.edit],
      ['exited', QUESTION_OF.edit],
      ['quit', QUESTION_OF.execute]
    ] as const) {
      const card = answeredDecisions(page).filter({ hasText: NOT_ANSWERED[reason] })
      await expect(card, `${check} (after a restart): no card "Permission answered" shows "${NOT_ANSWERED[reason]}" (${reason}).`).toHaveCount(1)
      await expect(card, `${check} (after a restart): the ${reason} card must show its question "${question}".`).toContainText(question)
      await expect(card.getByRole('button'), `${check} (after a restart): the ${reason} card must show no button.`).toHaveCount(0)
    }
  })

  test('S5-31: after a kill of Aether with a card open, the next start changes the saved outcome open to interrupted before the session opens, and the card shows "Not answered: Aether stopped unexpectedly." with no button', async ({
    chat
  }) => {
    const check = 'S5-31'
    await chat.control.scenario('steps', { prompt: [ask(RUN), gate('never')] })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    await startSession(page, 'Run the tests', check)
    await expect(openDecision(page, RUN.title), `${check}: the agent asked a permission, but no card "Permission request" shows.`).toHaveCount(1)

    // The crash. The card was saved when it opened.
    await killApp(chat)
    let data = await chat.readDatabase()
    const dump = () => `The database holds:\n${data.describe()}`
    expect(answersEntries(data), `${check}: after the kill, the database must hold the entry "answers" of the open card, with the outcome open.\n${dump()}`).toEqual([
      { kind: 'answers', card: 'decision', toolId: RUN.id, outcome: 'open', rows: [{ question: QUESTION_OF.execute, answer: null }] }
    ])

    // The next start repairs the entry before any window shows the session.
    await chat.start()
    await chat.stop()
    data = await chat.readDatabase()
    expect(
      answersEntries(data).map(({ outcome }) => outcome),
      `${check}: the start after the kill must change the outcome open to interrupted, before the session opens.\n${dump()}`
    ).toEqual(['interrupted'])

    const again = await restartAndOpen(chat, 'Run the tests', check)
    const card = answeredDecisions(again)
    await expect(card, `${check}: after the crash, the log must show the card as "Permission answered".`).toHaveCount(1)
    await expect(card, `${check}: after the crash, the card must show "${NOT_ANSWERED.interrupted}".`).toContainText(NOT_ANSWERED.interrupted)
    await expect(card, `${check}: after the crash, the card must show its question "${QUESTION_OF.execute}".`).toContainText(QUESTION_OF.execute)
    await expect(card.getByRole('button'), `${check}: after the crash, the card must show no button.`).toHaveCount(0)
    await expect(openDecisions(again), `${check}: after the crash, a card "Permission request" is open again.`).toHaveCount(0)
  })
})
