// S11 of milestone m1-chat, on the built app: the status icon of a session row (A25).
// Spec: `docs/milestones/m1-chat/stories/s11-sidebar-status.md`, checks S11-5 to S11-12. The UI
// contract is in `fixture.ts`.
//
// The focus. The test windows are hidden, so the focus flag of the main process starts false. Each
// test sends `focus` or `blur` to the window first (`setWindowFocus`), so that the rule of the
// unread mark has a known input.
//
// A check that a mark does not come first waits for the end of the turn (the composer is ready),
// then for `settle`: a later call through the bridge and three frames.
import {
  alerts,
  animates,
  ask,
  answers,
  COLOR,
  day,
  expect,
  expectReady,
  expectReplyShown,
  expectShown,
  expectState,
  groupRow,
  groupToggle,
  icon,
  newPageRow,
  openDecisions,
  openSession,
  reach,
  replyStep,
  sessionEntry,
  setWindowFocus,
  settle,
  shownColors,
  startImported,
  startTurn,
  STATE,
  stopButton,
  test,
  transcript,
  waitAt,
  writeOldProfile,
  type ChatApp
} from './fixture'

const A = 'Fix the login page'
const B = 'Sort the notes'
const C = 'Write the release notes'

/** Session A and B in `repo-a`, C in `repo-b`. All are drafts of the old file. */
async function startWithDrafts(chat: ChatApp) {
  await writeOldProfile(chat, [
    { prompt: C, folder: 'repo-b', createdAt: day(1) },
    { prompt: B, folder: 'repo-a', createdAt: day(2) },
    { prompt: A, folder: 'repo-a', createdAt: day(3) }
  ])
  return startImported(chat)
}

/** Checks the "New answer" state of a row: the description, and the chat icon in `--unread`. */
async function expectNewAnswer(page: Parameters<typeof expectState>[0], title: string, check: string): Promise<void> {
  await expectState(page, title, STATE.unread, check)
  await expect
    .poll(() => shownColors(icon(sessionEntry(page, title), 'message-square')), {
      message: `${check}: the row "${title}" must show the chat icon in the color --unread (${COLOR.unread}).`
    })
    .toEqual([COLOR.unread])
}

test.describe('S11 status: Working, New answer and Needs your answer on the session rows', () => {
  test('S11-5: while a turn runs, the row has "Working" and an animation; with reduced motion no animation; after the turn no "Working"', async ({ chat }) => {
    const check = 'S11-5'
    const page = await startWithDrafts(chat)
    // With the focus on the viewed session, the end of the turn sets no mark: the row goes back to normal.
    await setWindowFocus(chat, true)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await startTurn(chat, page, A, 'work-a', { prompt: [waitAt('work-a'), replyStep] }, check)

    await expectState(page, A, STATE.working, check)
    await expect.poll(() => animates(sessionEntry(page, A)), { message: `${check}: the row "${A}" runs no animation while Claude works.` }).toBe(true)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect
      .poll(() => animates(sessionEntry(page, A)), { message: `${check}: with reduced motion, the row "${A}" must run no animation.` })
      .toBe(false)
    await expectState(page, A, STATE.working, `${check} (reduced motion)`)

    await chat.control.open('work-a')
    await expectReplyShown(page, check)
    await expectReady(page, check)
    await settle(page)
    await expectState(page, A, '', `${check}: after the turn`)
  })

  test('S11-6: with B open and the focus on the window, the end of the turn of A gives A "New answer"; opening A clears it', async ({ chat }) => {
    const check = 'S11-6'
    const page = await startWithDrafts(chat)
    await setWindowFocus(chat, true)
    await startTurn(chat, page, A, 'reply-a', { prompt: [waitAt('reply-a'), replyStep] }, check)
    await openSession(page, B, check)
    await chat.control.open('reply-a')

    await expectNewAnswer(page, A, check)
    await expectState(page, B, '', `${check}: the open session B`)
    // The mark stays until the user opens A.
    await settle(page)
    await expectState(page, A, STATE.unread, `${check}: before A is opened`)

    await openSession(page, A, check)
    await expectReplyShown(page, check)
    await expectState(page, A, '', `${check}: after the user opened A`)
  })

  test('S11-7: with A open, a blur, then the end of the turn of A, gives A "New answer"; the focus then clears it', async ({ chat }) => {
    const check = 'S11-7'
    const page = await startWithDrafts(chat)
    await setWindowFocus(chat, true)
    await startTurn(chat, page, A, 'reply-a', { prompt: [waitAt('reply-a'), replyStep] }, check)
    await setWindowFocus(chat, false)
    await chat.control.open('reply-a')
    await expectReplyShown(page, check)

    await expectNewAnswer(page, A, `${check}: the window had no focus at the end of the turn`)
    await setWindowFocus(chat, true)
    await expectState(page, A, '', `${check}: after the window got the focus, with A open`)
  })

  test('S11-8: with A open and the focus on the window, the end of the turn of A sets no mark', async ({ chat }) => {
    const check = 'S11-8'
    const page = await startWithDrafts(chat)
    await setWindowFocus(chat, true)
    await startTurn(chat, page, A, 'reply-a', { prompt: [waitAt('reply-a'), replyStep] }, check)
    // The row has its state while the turn runs, so the check below reads the same description.
    await expectState(page, A, STATE.working, `${check}: during the turn`)
    await chat.control.open('reply-a')
    await expectReplyShown(page, check)
    await expectReady(page, check)
    await settle(page)
    await expectState(page, A, '', `${check}: after the turn of the open, focused session A`)
  })

  test('S11-9: a session with the unread mark keeps it after a restart', async ({ chat }) => {
    const check = 'S11-9'
    let page = await startWithDrafts(chat)
    await setWindowFocus(chat, true)
    await startTurn(chat, page, A, 'reply-a', { prompt: [waitAt('reply-a'), replyStep] }, check)
    await openSession(page, B, check)
    await chat.control.open('reply-a')
    await expectNewAnswer(page, A, `${check}: before the restart`)

    await chat.stop()
    page = await chat.start()
    await expectNewAnswer(page, A, `${check}: after the restart`)
  })

  test('S11-10: a permission card in A, which is not open, gives A "Needs your answer" with the hand; after the agent withdraws it, the hand goes away', async ({
    chat
  }) => {
    const check = 'S11-10'
    const page = await startWithDrafts(chat)
    await setWindowFocus(chat, true)
    await startTurn(
      chat,
      page,
      A,
      'ask-a',
      {
        prompt: [
          waitAt('ask-a'),
          ask({ id: 'run-tests', title: 'npm test', kind: 'execute' }),
          waitAt('withdraw-a'),
          { do: 'withdraw', id: 'run-tests' },
          answers,
          replyStep
        ]
      },
      check
    )
    await openSession(page, B, check)
    await chat.control.open('ask-a')

    await expectState(page, A, STATE.attention, check)
    const hand = icon(sessionEntry(page, A), 'hand')
    await expectShown(hand, true, `${check}: the row "${A}" shows no hand (lucide-hand).`)
    await expect
      .poll(() => shownColors(hand), { message: `${check}: the hand must have the color --attention (${COLOR.attention}).` })
      .toEqual([COLOR.attention])

    await reach(chat.control.waitForGate('withdraw-a'), `${check}: the agent never came to the withdraw.`)
    await chat.control.open('withdraw-a')
    // The withdraw closes the card, and the turn then ends while A is not open.
    await expectState(page, A, STATE.unread, `${check}: after the withdraw and the end of the turn`)
    await expectShown(hand, false, `${check}: after the withdraw, the row "${A}" still shows the hand.`)
  })

  test('S11-11: a collapsed group with a session that needs the user shows the hand; a collapsed group with an unread session shows the blue icon', async ({
    chat
  }) => {
    const check = 'S11-11'
    const page = await startWithDrafts(chat)
    await setWindowFocus(chat, true)

    // C (repo-b) answers while the New page is open: C gets the mark.
    await startTurn(chat, page, C, 'reply-c', { prompt: [waitAt('reply-c'), replyStep] }, check)
    await newPageRow(page).click()
    await chat.control.open('reply-c')
    await expectState(page, C, STATE.unread, `${check}: C`)

    // A (repo-a) opens a permission card that waits.
    await startTurn(chat, page, A, 'ask-a', { prompt: [waitAt('ask-a'), ask({ id: 'run-tests', title: 'npm test', kind: 'execute' }), answers, replyStep] }, check)
    await chat.control.open('ask-a')
    await expect(openDecisions(page), `${check}: the permission card of A does not open.`).toHaveCount(1)
    await newPageRow(page).click()
    await expectState(page, A, STATE.attention, `${check}: A`)

    for (const name of ['repo-a', 'repo-b']) {
      const toggle = groupToggle(page, name)
      await expect(toggle, `${check}: the sidebar has no group "${name}" (a button named "${name}" with aria-expanded).`).toBeVisible()
      await toggle.click()
      await expect(toggle, `${check}: the group "${name}" does not collapse.`).toHaveAttribute('aria-expanded', 'false')
    }
    await expect(sessionEntry(page, A), `${check}: the rows of the collapsed group "repo-a" must hide.`).toBeHidden()

    await expect(groupToggle(page, 'repo-a'), `${check}: the collapsed group "repo-a" must have the description "${STATE.attention}".`).toHaveAccessibleDescription(
      STATE.attention
    )
    await expectShown(icon(groupRow(page, 'repo-a'), 'hand'), true, `${check}: the collapsed group "repo-a" shows no hand.`)
    await expect(groupToggle(page, 'repo-b'), `${check}: the collapsed group "repo-b" must have the description "${STATE.unread}".`).toHaveAccessibleDescription(
      STATE.unread
    )
    await expect
      .poll(() => shownColors(icon(groupRow(page, 'repo-b'), 'message-square')), {
        message: `${check}: the collapsed group "repo-b" must show the chat icon in the color --unread (${COLOR.unread}).`
      })
      .toEqual([COLOR.unread])
  })

  test('S11-12: a start that fails (not signed in) while the session is not open gives "New answer"; a stop by the user sets no mark', async ({ chat }) => {
    const check = 'S11-12'
    const page = await startWithDrafts(chat)
    await setWindowFocus(chat, true)

    // A: the agent refuses the start, as an ACP agent does when nobody is signed in.
    await startTurn(
      chat,
      page,
      A,
      'start-a',
      { initialize: [waitAt('start-a'), { do: 'fail', code: -32000, message: 'Authentication required' }] },
      check
    )
    await openSession(page, B, check)
    await chat.control.open('start-a')
    await expectState(page, A, STATE.unread, `${check}: the failed start of A`)
    await openSession(page, A, check)
    await expect(
      alerts(page).filter({ hasText: 'Claude Code is not signed in.' }),
      `${check}: the start of A did not fail as "not signed in", so the test does not check its case.`
    ).toBeVisible()

    // B: the user stops the turn. The window has no focus, so a normal end would set the mark.
    await startTurn(chat, page, B, 'hold-b', { prompt: [waitAt('hold-b'), replyStep] }, check)
    await setWindowFocus(chat, false)
    await stopButton(page).click()
    await expect(transcript(page).getByText('Stopped.', { exact: true }), `${check}: the stop of B shows no "Stopped.".`).toBeVisible()
    await expectReady(page, check)
    await settle(page)
    await expectState(page, B, '', `${check}: after the stop of B`)
  })
})
