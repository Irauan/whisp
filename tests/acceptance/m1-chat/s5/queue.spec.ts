// A4, A5, S5-1, S5-17, S5-18 and S5-19 of milestone m1-chat: the permission queue, on the built app.
//
// A4: the agent asks two permissions at the same time. The user allows the first and refuses the
// second. Both cards show. The agent receives each answer for its own request. (live)
// A5: two open requests. The user clicks Stop. Both cards show as not answered, with the reason
// "Not answered: you pressed Stop.". The agent receives `cancelled` for both.
// S5-1: the user answers the second card first. Each request gets its own answer.
// S5-17: two open cards show inside the log "Transcript", at the place where they arrived, in the
// order of arrival. A later entry comes after them. The dock holds no card.
// S5-18: the user scrolled up. A new card comes. The log does not move. The status line shows
// "Waiting for your answer" and "Show request". A click brings the oldest open card into view and
// focuses it.
// S5-19: a new card does not take the focus: a key typed in "Prompt" goes to the composer.
//
// `fixture.ts` describes the UI contract. No test sleeps.
import {
  allCards,
  answeredDecisions,
  answers,
  ask,
  buttonIn,
  DRAFT_IN_REPO_A,
  expect,
  expectReady,
  gate,
  holdsFocus,
  isAtBottom,
  linesOf,
  main,
  nextFrames,
  NOT_ANSWERED,
  openDecision,
  openDecisions,
  promptField,
  QUESTION_OF,
  reach,
  say,
  scrollFacts,
  showRequest,
  startImported,
  startSession,
  stopButton,
  test,
  toolCall,
  topOf,
  transcript,
  TWO_REQUESTS,
  waitingStatus,
  wheelOver,
  writeOldProfile,
  type ChatApp
} from './fixture'

const [RUN, READ] = TWO_REQUESTS as [(typeof TWO_REQUESTS)[number], (typeof TWO_REQUESTS)[number]]

/** Starts a session in repo-a whose agent runs these prompt steps. */
async function startWith(chat: ChatApp, prompt: unknown[], check: string) {
  await chat.control.scenario('steps', { prompt })
  await writeOldProfile(chat, [DRAFT_IN_REPO_A])
  const page = await startImported(chat)
  await startSession(page, 'Run the tests and read the log', check)
  return page
}

/** Checks that the session window shows one open card for each of the two requests. */
async function expectTwoCards(page: Parameters<typeof openDecisions>[0], check: string): Promise<void> {
  await expect(
    openDecisions(page),
    `${check}: the agent asked two permissions at the same time, but the log "Transcript" does not show two cards "Permission request".`
  ).toHaveCount(2)
  await expect(openDecision(page, RUN.title), `${check}: no open card shows the tool "${RUN.title}".`).toHaveCount(1)
  await expect(openDecision(page, READ.title), `${check}: no open card shows the tool "${READ.title}".`).toHaveCount(1)
}

test.describe('A4, A5, S5-1, S5-17, S5-18 and S5-19: the permission queue', () => {
  test('A4: two permissions at the same time show two cards; Allow on the first and Refuse on the second reach the agent, each for its own request', async ({
    chat
  }) => {
    const check = 'A4'
    const page = await startWith(chat, [ask(RUN, READ), answers, say('Both answered.')], check)
    await expectTwoCards(page, check)
    expect(chat.control.permissionAnswers, `${check}: the agent got an answer before the user clicked.`).toEqual([])

    await buttonIn(openDecision(page, RUN.title), 'Allow').click()
    expect(await reach(chat.control.waitForPermission(RUN.id), `${check}: the agent got no answer for "${RUN.title}".`), `${check}: the agent must get "Allow" for "${RUN.title}".`).toEqual({
      id: RUN.id,
      outcome: { outcome: 'selected', optionId: 'yes' }
    })
    // The second card is still open after the first answer.
    await expect(openDecision(page, READ.title), `${check}: the second card closed when the user answered the first one.`).toHaveCount(1)
    await buttonIn(openDecision(page, READ.title), 'Refuse').click()
    expect(await reach(chat.control.waitForPermission(READ.id), `${check}: the agent got no answer for "${READ.title}".`), `${check}: the agent must get "Refuse" for "${READ.title}".`).toEqual({
      id: READ.id,
      outcome: { outcome: 'selected', optionId: 'no' }
    })
    await expect(main(page).getByText('Both answered.', { exact: true }), `${check}: the turn does not go on after both answers.`).toBeVisible()
    expect(chat.control.permissionAnswers, `${check}: each request must get exactly one answer.`).toHaveLength(2)
    await expect(toolCall(page, RUN.title), `${check}: the allowed tool call must show "Completed".`).toContainText('Completed')
    await expect(toolCall(page, READ.title), `${check}: the refused tool call must show "Failed".`).toContainText('Failed')
  })

  test('S5-1: the user answers the second card first, and each request gets its own answer', async ({ chat }) => {
    const check = 'S5-1'
    const page = await startWith(chat, [ask(RUN, READ), answers, say('Both answered.')], check)
    await expectTwoCards(page, check)

    await buttonIn(openDecision(page, READ.title), 'Allow').click()
    expect(await reach(chat.control.waitForPermission(READ.id), `${check}: the agent got no answer for the second request.`), `${check}: the second request must get "Allow".`).toEqual({
      id: READ.id,
      outcome: { outcome: 'selected', optionId: 'yes' }
    })
    expect(chat.control.permissionAnswers.map(({ id }) => id), `${check}: the answer to the second card reached another request.`).toEqual([READ.id])
    await expect(openDecision(page, RUN.title), `${check}: the first card must stay open after the answer to the second.`).toHaveCount(1)

    await buttonIn(openDecision(page, RUN.title), 'Refuse').click()
    expect(await reach(chat.control.waitForPermission(RUN.id), `${check}: the agent got no answer for the first request.`), `${check}: the first request must get "Refuse".`).toEqual({
      id: RUN.id,
      outcome: { outcome: 'selected', optionId: 'no' }
    })
    await expect(main(page).getByText('Both answered.', { exact: true }), `${check}: the turn does not go on after both answers.`).toBeVisible()
  })

  test('A5: Stop with two open requests shows both cards as not answered, with "Not answered: you pressed Stop.", and the agent receives cancelled for both', async ({
    chat
  }) => {
    const check = 'A5'
    const page = await startWith(chat, [ask(RUN, READ), answers, say('Not sent.')], check)
    await expectTwoCards(page, check)
    await expect(stopButton(page), `${check}: the button "Stop" does not show while two cards are open.`).toBeEnabled()

    await stopButton(page).click()
    expect(await reach(chat.control.waitForPermission(RUN.id), `${check}: the agent got no answer for "${RUN.title}" after Stop.`), `${check}: the agent must get cancelled for "${RUN.title}".`).toEqual({
      id: RUN.id,
      outcome: { outcome: 'cancelled' }
    })
    expect(await reach(chat.control.waitForPermission(READ.id), `${check}: the agent got no answer for "${READ.title}" after Stop.`), `${check}: the agent must get cancelled for "${READ.title}".`).toEqual({
      id: READ.id,
      outcome: { outcome: 'cancelled' }
    })
    await expect(openDecisions(page), `${check}: a card "Permission request" is still open after Stop.`).toHaveCount(0)
    await expect(answeredDecisions(page), `${check}: after Stop, both cards must stay as cards "Permission answered".`).toHaveCount(2)
    for (const [title, kind] of [
      [RUN.title, 'execute'],
      [READ.title, 'read']
    ] as const) {
      const card = answeredDecisions(page).filter({ hasText: QUESTION_OF[kind] })
      await expect(card, `${check}: no card "Permission answered" shows the question "${QUESTION_OF[kind]}" of "${title}".`).toHaveCount(1)
      await expect(card, `${check}: the card of "${title}" must show "${NOT_ANSWERED.stopped}".`).toContainText(NOT_ANSWERED.stopped)
      await expect(card.getByRole('button'), `${check}: the card of "${title}" still shows buttons after Stop.`).toHaveCount(0)
    }
    await expect(main(page).getByText('Stopped.', { exact: true }), `${check}: "Stopped." does not show after Stop.`).toBeVisible()
    await expect(toolCall(page, RUN.title), `${check}: the open tool call "${RUN.title}" must show "Failed" after Stop.`).toContainText('Failed')
    await expect(toolCall(page, READ.title), `${check}: the open tool call "${READ.title}" must show "Failed" after Stop.`).toContainText('Failed')
    await expectReady(page, check)
  })

  test('S5-17: two open cards show inside the log, each right after its tool call, in the order of arrival; a later entry comes after them; the dock holds no card', async ({
    chat
  }) => {
    const check = 'S5-17'
    const later = 'I wait for your answers.'
    const page = await startWith(chat, [ask(RUN, READ), say(later), answers, say('Both answered.')], check)
    await expectTwoCards(page, check)
    await expect(transcript(page).getByText(later, { exact: true }), `${check}: the later text of the agent does not show.`).toBeVisible()

    // Inside the log, and nowhere else in the session window.
    await expect(allCards(page), `${check}: the session window shows a card outside the log "Transcript" (for example in the dock).`).toHaveCount(2)

    // Tool A, card A, tool B, card B, then the later entry.
    const places = [
      ['the tool call A', await topOf(toolCall(page, RUN.title), `${check}: the tool call "${RUN.title}"`)],
      ['card A', await topOf(openDecision(page, RUN.title), `${check}: the card of "${RUN.title}"`)],
      ['the tool call B', await topOf(toolCall(page, READ.title), `${check}: the tool call "${READ.title}"`)],
      ['card B', await topOf(openDecision(page, READ.title), `${check}: the card of "${READ.title}"`)],
      ['the later entry', await topOf(transcript(page).getByText(later, { exact: true }), `${check}: the later text`)]
    ] as const
    const order = [...places].sort((a, b) => a[1] - b[1]).map(([name]) => name)
    expect(order, `${check}: the log must read: tool call A, card A, tool call B, card B, then the later entry.`).toEqual(places.map(([name]) => name))

    await buttonIn(openDecision(page, RUN.title), 'Allow').click()
    await buttonIn(openDecision(page, READ.title), 'Allow').click()
    await expect(main(page).getByText('Both answered.', { exact: true }), `${check}: the turn does not go on after both answers.`).toBeVisible()
  })

  test('S5-19: a new card does not take the focus, and a key typed in "Prompt" goes to the composer', async ({ chat }) => {
    const check = 'S5-19'
    const page = await startWith(chat, [say('I look at the tests first.'), gate('ask'), ask(RUN), answers, say('Done.')], check)
    await reach(chat.control.waitForGate('ask'), `${check}: the agent did not get the prompt.`)
    const field = promptField(page)
    await field.click()
    await page.keyboard.type('Fix the ')
    await expect(field).toHaveValue('Fix the ')

    await chat.control.open('ask')
    await expect(openDecisions(page), `${check}: the agent asked a permission, but no card "Permission request" shows.`).toHaveCount(1)
    await nextFrames(page)
    await expect(field, `${check}: the new card took the keyboard focus away from "Prompt".`).toBeFocused()
    await page.keyboard.type('parser')
    await expect(field, `${check}: the keys typed after the card came did not reach "Prompt".`).toHaveValue('Fix the parser')
    expect(chat.control.permissionAnswers, `${check}: a key typed for the composer answered the card.`).toEqual([])
    await expect(openDecisions(page), `${check}: a key typed for the composer closed the card.`).toHaveCount(1)

    await buttonIn(openDecisions(page), 'Allow').click()
    await reach(chat.control.waitForPermission(RUN.id), `${check}: the agent got no answer.`)
  })

  test('S5-18: a card that comes while the user scrolled up does not move the log; the status line shows "Waiting for your answer" and "Show request", which brings the oldest open card into view and focuses it', async ({
    chat
  }) => {
    const check = 'S5-18'
    const page = await startWith(chat, [say(linesOf(150, 'the long reply')), gate('ask'), ask(RUN, READ), answers, say('Done.')], check)
    const log = transcript(page)
    await reach(chat.control.waitForGate('ask'), `${check}: the agent did not get the prompt.`)
    await expect(log, `${check}: the long reply does not show.`).toContainText('Line 150 of the long reply.')
    await expect.poll(() => isAtBottom(log), { message: `${check}: the log does not follow the long reply to the bottom.` }).toBe(true)

    // The user scrolls up and the log comes to rest.
    await wheelOver(page, log, -1500, check)
    await expect.poll(() => isAtBottom(log), { message: `${check}: the wheel does not scroll the log up.` }).toBe(false)
    let position = -1
    await expect
      .poll(
        async () => {
          const before = (await scrollFacts(log)).scrollTop
          await nextFrames(page)
          position = (await scrollFacts(log)).scrollTop
          return position === before
        },
        { message: `${check}: the log does not come to rest after the user scrolled up.` }
      )
      .toBe(true)

    await chat.control.open('ask')
    await expect(openDecisions(page), `${check}: the agent asked two permissions, but the log does not hold two cards "Permission request".`).toHaveCount(2)
    await nextFrames(page)
    expect(
      Math.abs((await scrollFacts(log)).scrollTop - position),
      `${check}: the user scrolled up, but the new cards moved the log away from the position of the user (scrollTop ${position}).`
    ).toBeLessThanOrEqual(2)
    await expect(waitingStatus(page), `${check}: the status line does not say "Waiting for your answer" while cards are open.`).toBeVisible()
    await expect(showRequest(page), `${check}: the status line shows no button "Show request" while the log is not at the bottom.`).toBeVisible()
    await expect(openDecision(page, RUN.title), `${check}: the oldest card is in view before the click, so the check has no meaning.`).not.toBeInViewport()

    await showRequest(page).click()
    await expect(openDecision(page, RUN.title), `${check}: "Show request" does not bring the oldest open card into view.`).toBeInViewport()
    await expect
      .poll(() => holdsFocus(openDecision(page, RUN.title)), { message: `${check}: "Show request" does not move the focus to the oldest open card.` })
      .toBe(true)

    await buttonIn(openDecision(page, RUN.title), 'Allow').click()
    await buttonIn(openDecision(page, READ.title), 'Allow').click()
    await expect(main(page).getByText('Done.', { exact: true }), `${check}: the turn does not go on after both answers.`).toBeVisible()
  })
})
