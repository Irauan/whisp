// S5-6, S5-20, S5-24, S5-26 and S5-27 of milestone m1-chat: the decision cards, on the built app.
//
// S5-6: a safety ask with "No" first. "No" is the first and the primary button. In another request,
// the first `allow-once` option is first and primary.
// S5-20: after the user picks "Allow", the decision card stays in the transcript with no buttons. It
// shows the question in the secondary color and "Allow" in the primary color. After a restart it shows
// the same. Stop on an open decision card shows "Not answered: you pressed Stop.".
// S5-24: a decision card with "Yes", "Yes, and don't ask again for …" and "No" shows the primary split
// button "Yes", its dropdown "More allow options" with the menuitem of the "always" option, and the
// button "No". The menuitem sends its option. A safety ask puts the refuse group first and primary.
// The card shows the context in the secondary color and the question in the primary color.
// S5-26: at a wide width, the buttons of a decision card sit on one line, each sized to its content.
// At a narrow width (375 px), each button takes the full width of the card, at equal size, stacked.
// S5-27: while an answer is being sent, the card shows no disabled button: it shows the answered
// layout with a spinner, and keeps the name "Permission request". When main accepts the answer, it
// becomes "Permission answered". When main refuses the answer, the card goes back to its buttons,
// with the error line.
//
// User decisions, 2026-11-27 (spec, "Decision cards", open choices 1, 2 and 7): the labels of Claude,
// the "always" options in the dropdown of the allow group, and the recommended option first and primary.
// `fixture.ts` describes the UI contract. No test sleeps.
import type { Locator, Page } from '@playwright/test'
import {
  animates,
  answeredDecisions,
  answers,
  ask,
  buttonIn,
  buttonNames,
  colorOf,
  DRAFT_IN_REPO_A,
  expect,
  expectPrimary,
  heldCalls,
  holdAnswers,
  main,
  NOT_ANSWERED,
  openDecision,
  openDecisions,
  PLAN_EXIT_OPTIONS,
  QUESTION_OF,
  reach,
  releaseAnswers,
  resizeSession,
  resolvedColor,
  restartAndOpen,
  say,
  SHELL_OPTIONS,
  startImported,
  startSession,
  stopButton,
  stopHolding,
  test,
  writeOldProfile,
  type Ask,
  type ChatApp
} from './fixture'

const TITLE = 'Plan the change'

async function startWith(chat: ChatApp, prompt: unknown[], check: string): Promise<Page> {
  await chat.control.scenario('steps', { prompt })
  await writeOldProfile(chat, [DRAFT_IN_REPO_A])
  const page = await startImported(chat)
  await startSession(page, TITLE, check)
  return page
}

/** A safety ask: Claude Code puts the refuse option first (`defaultToNo`). */
const SAFETY: Ask = {
  id: 'remove-build',
  title: 'rm -rf build',
  kind: 'execute',
  options: [
    { optionId: 'reject', name: 'No', kind: 'reject_once' },
    { optionId: 'allow', name: 'Yes', kind: 'allow_once' }
  ]
}

/** The plan exit of Claude Code with auto mode: two "always" options before the allow-once option. */
const PLAN_EXIT_WITH_AUTO: Ask = {
  id: 'plan',
  title: 'Approve Plan',
  kind: 'switch_mode',
  options: [
    { optionId: 'exit-plan-auto', name: 'Yes, and use auto mode', kind: 'allow_always' },
    { optionId: 'exit-plan-bypass', name: 'Yes, and bypass permissions', kind: 'allow_always' },
    { optionId: 'exit-plan-default', name: 'Yes, manually approve edits', kind: 'allow_once' },
    { optionId: 'reject', name: 'No, keep planning', kind: 'reject_once' }
  ]
}

/** The visible box of an element. */
async function boxOf(locator: Locator, what: string) {
  const box = await locator.boundingBox()
  if (!box) throw new Error(`${what} has no box.`)
  return box
}

/** The content box of a card: its box without its border and its padding. */
async function contentOf(card: Locator, what: string) {
  const box = await boxOf(card, what)
  const inset = await card.evaluate((element) => {
    const style = (globalThis as unknown as { getComputedStyle(node: unknown): Record<string, string> }).getComputedStyle(element)
    const px = (name: string) => Number.parseFloat(style[name] ?? '0') || 0
    return {
      left: px('paddingLeft') + px('borderLeftWidth'),
      right: px('paddingRight') + px('borderRightWidth')
    }
  })
  return { left: box.x + inset.left, right: box.x + box.width - inset.right, width: box.width - inset.left - inset.right }
}

test.describe('S5-6, S5-20, S5-24, S5-26 and S5-27: decision cards', () => {
  test('S5-6: on a safety ask "No" is the first and the primary button; on another request the first allow-once option is first and primary', async ({
    chat
  }) => {
    const check = 'S5-6'
    const page = await startWith(chat, [ask(SAFETY, PLAN_EXIT_WITH_AUTO), answers, say('Both answered.')], check)
    await expect(openDecisions(page), `${check}: the agent asked two permissions, but the log does not show two cards "Permission request".`).toHaveCount(2)

    // The safety ask keeps the order of the agent: "No" first, and primary.
    const safety = openDecision(page, SAFETY.title)
    await expect(safety, `${check}: no open card shows the tool "${SAFETY.title}".`).toHaveCount(1)
    expect((await buttonNames(safety))[0], `${check}: on the safety ask, the first button must be "No".`).toBe('No')
    await expectPrimary(page, buttonIn(safety, 'No'), true, `${check}: on the safety ask, "No" must be the primary button.`)
    await expectPrimary(page, buttonIn(safety, 'Yes'), false, `${check}: on the safety ask, "Yes" must not be primary.`)

    // The plan exit: the first allow-once option comes first and is primary, before the two "always" options of the agent.
    const plan = openDecision(page, PLAN_EXIT_WITH_AUTO.title)
    await expect(plan, `${check}: no open card shows the tool "${PLAN_EXIT_WITH_AUTO.title}".`).toHaveCount(1)
    expect((await buttonNames(plan))[0], `${check}: on the plan exit, the first button must be the first allow-once option "Yes, manually approve edits".`).toBe(
      'Yes, manually approve edits'
    )
    await expectPrimary(page, buttonIn(plan, 'Yes, manually approve edits'), true, `${check}: "Yes, manually approve edits" must be the primary button.`)
    await expectPrimary(page, buttonIn(plan, 'No, keep planning'), false, `${check}: "No, keep planning" must not be primary.`)

    // Each main part sends its own option.
    await buttonIn(safety, 'No').click()
    expect(await reach(chat.control.waitForPermission(SAFETY.id), `${check}: the agent got no answer to the safety ask.`), `${check}: "No" must send its option.`).toEqual({
      id: SAFETY.id,
      outcome: { outcome: 'selected', optionId: 'reject' }
    })
    await buttonIn(plan, 'Yes, manually approve edits').click()
    expect(await reach(chat.control.waitForPermission(PLAN_EXIT_WITH_AUTO.id), `${check}: the agent got no answer to the plan exit.`), `${check}: the main part must send its option.`).toEqual({
      id: PLAN_EXIT_WITH_AUTO.id,
      outcome: { outcome: 'selected', optionId: 'exit-plan-default' }
    })
  })

  test('S5-24: "Yes" is a primary split button with "More allow options" and the menuitem of the "always" option, which sends its option; a safety ask puts the refuse group first; context secondary, question primary', async ({
    chat
  }) => {
    const check = 'S5-24'
    const shell: Ask = { id: 'run-tests', title: 'npm test', kind: 'execute', options: SHELL_OPTIONS }
    const safety: Ask = {
      id: 'remove-build',
      title: 'rm -rf build',
      kind: 'execute',
      options: [
        { optionId: 'reject', name: 'No', kind: 'reject_once' },
        { optionId: 'allow', name: 'Yes', kind: 'allow_once' },
        { optionId: 'allow-always', name: "Yes, and don't ask again for rm commands", kind: 'allow_always' }
      ]
    }
    const page = await startWith(chat, [ask(shell, safety), answers, say('Both answered.')], check)
    await expect(openDecisions(page), `${check}: the agent asked two permissions, but the log does not show two cards "Permission request".`).toHaveCount(2)
    const card = openDecision(page, shell.title)
    await expect(card, `${check}: no open card shows the tool "${shell.title}".`).toHaveCount(1)

    // Context in the secondary color, the question in the primary color.
    const muted = await resolvedColor(page, 'var(--muted)')
    const text = await resolvedColor(page, 'var(--text)')
    await expect(card, `${check}: the context of the card must name the tool kind "execute".`).toContainText('execute')
    const context = card.getByText(shell.title, { exact: true })
    await expect(context, `${check}: the context of the card does not show the tool title "${shell.title}".`).toBeVisible()
    expect(await colorOf(context), `${check}: the context (the tool title) must have the secondary color (--muted).`).toBe(muted)
    const question = card.getByText(QUESTION_OF.execute, { exact: true })
    await expect(question, `${check}: the card does not show the question "${QUESTION_OF.execute}".`).toBeVisible()
    expect(await colorOf(question), `${check}: the question must have the primary color (--text).`).toBe(text)

    // The allow group is a split button: the primary main part "Yes" and the dropdown part. Then "No".
    expect(await buttonNames(card), `${check}: the card must show the main part "Yes", its dropdown "More allow options", then "No".`).toEqual([
      'Yes',
      'More allow options',
      'No'
    ])
    await expectPrimary(page, buttonIn(card, 'Yes'), true, `${check}: the main part "Yes" must be primary.`)
    await expectPrimary(page, buttonIn(card, 'No'), false, `${check}: "No" must not be primary.`)
    const more = buttonIn(card, 'More allow options')
    await expect(more, `${check}: the dropdown part must have aria-haspopup="menu".`).toHaveAttribute('aria-haspopup', 'menu')
    await expect(card.getByRole('button', { name: SHELL_OPTIONS[1]!.name }), `${check}: the "always" option must not be a button of its own.`).toHaveCount(0)

    // The safety ask: the refuse group first and primary, then the allow group with its dropdown.
    const refusing = openDecision(page, safety.title)
    expect(await buttonNames(refusing), `${check}: on the safety ask, the refuse group must come first, then the split button "Yes".`).toEqual([
      'No',
      'Yes',
      'More allow options'
    ])
    await expectPrimary(page, buttonIn(refusing, 'No'), true, `${check}: on the safety ask, "No" must be primary.`)
    await expectPrimary(page, buttonIn(refusing, 'Yes'), false, `${check}: on the safety ask, the main part "Yes" must not be primary.`)

    // The menuitem sends the "always" option of the agent.
    await more.click()
    const menu = page.getByRole('menu')
    await expect(menu, `${check}: "More allow options" opens no menu.`).toBeVisible()
    const always = menu.getByRole('menuitem', { name: SHELL_OPTIONS[1]!.name, exact: true })
    await expect(always, `${check}: the menu has no menuitem "${SHELL_OPTIONS[1]!.name}", with the label of Claude.`).toBeVisible()
    await expect(menu.getByRole('menuitem'), `${check}: the menu must hold only the other allow option.`).toHaveCount(1)
    await always.click()
    expect(await reach(chat.control.waitForPermission(shell.id), `${check}: the menuitem sent no answer.`), `${check}: the menuitem must send the "always" option.`).toEqual({
      id: shell.id,
      outcome: { outcome: 'selected', optionId: 'allow-always' }
    })
    const answered = answeredDecisions(page).filter({ hasText: SHELL_OPTIONS[1]!.name })
    await expect(answered, `${check}: the answered card must show the chosen label "${SHELL_OPTIONS[1]!.name}".`).toHaveCount(1)

    await buttonIn(refusing, 'No').click()
    expect(await reach(chat.control.waitForPermission(safety.id), `${check}: the agent got no answer to the safety ask.`)).toEqual({
      id: safety.id,
      outcome: { outcome: 'selected', optionId: 'reject' }
    })
  })

  test('S5-26: at a wide width the buttons of a decision card sit on one line, each sized to its content; at 375 px each takes the full width of the card, at equal size, stacked', async ({
    chat
  }) => {
    const check = 'S5-26'
    const plan: Ask = { id: 'plan', title: 'Approve Plan', kind: 'switch_mode', options: PLAN_EXIT_OPTIONS }
    const page = await startWith(chat, [ask(plan), answers, say('Done.')], check)
    const card = openDecision(page, plan.title)
    await expect(card, `${check}: the agent asked a permission, but no card "Permission request" shows.`).toHaveCount(1)
    const main1 = buttonIn(card, 'Yes, manually approve edits')
    const more = buttonIn(card, 'More allow options')
    const no = buttonIn(card, 'No, keep planning')
    for (const [button, name] of [
      [main1, 'Yes, manually approve edits'],
      [more, 'More allow options'],
      [no, 'No, keep planning']
    ] as const) {
      await expect(button, `${check}: the plan exit card has no button "${name}".`).toBeVisible()
    }

    // Wide: one line, each button sized to its content.
    const wide = await contentOf(card, `${check}: the card`)
    const [a, b, c] = [await boxOf(main1, 'main part'), await boxOf(more, 'dropdown part'), await boxOf(no, '"No, keep planning"')]
    const middle = (box: { y: number; height: number }) => box.y + box.height / 2
    expect(Math.abs(middle(a) - middle(c)), `${check}: at a wide width, the buttons must sit on one line.`).toBeLessThanOrEqual(2)
    expect(Math.abs(middle(a) - middle(b)), `${check}: at a wide width, the dropdown part must sit on the line of its main part.`).toBeLessThanOrEqual(2)
    expect(c.width, `${check}: at a wide width, "No, keep planning" must size to its content, not to the width of the card.`).toBeLessThan(wide.width / 2)
    expect(a.width, `${check}: at a wide width, the main part must size to its content, not to the width of the card.`).toBeLessThan(wide.width / 2)

    // Narrow: the session window is 375 px wide. Each button takes the full width, at equal size, stacked.
    await resizeSession(chat, page, 375)
    await expect
      .poll(async () => {
        const [top, bottom] = [await boxOf(main1, 'main part'), await boxOf(no, '"No, keep planning"')]
        return bottom.y >= top.y + top.height - 1
      }, { message: `${check}: at 375 px, the buttons do not stack: "No, keep planning" must sit below the split button.` })
      .toBe(true)
    const narrow = await contentOf(card, `${check}: the card at 375 px`)
    const [n1, n2, n3] = [await boxOf(main1, 'main part'), await boxOf(more, 'dropdown part'), await boxOf(no, '"No, keep planning"')]
    expect(Math.abs(middle(n1) - middle(n2)), `${check}: at 375 px, the split button must keep its dropdown part on its line.`).toBeLessThanOrEqual(2)
    expect(n2.x + n2.width, `${check}: at 375 px, the dropdown part must sit at the right end of the split button.`).toBeGreaterThan(n1.x + n1.width - 1)
    expect(Math.abs(n1.x - narrow.left), `${check}: at 375 px, the split button must start at the left edge of the card.`).toBeLessThanOrEqual(2)
    expect(Math.abs(n2.x + n2.width - narrow.right), `${check}: at 375 px, the split button must reach the right edge of the card.`).toBeLessThanOrEqual(2)
    expect(Math.abs(n3.x - narrow.left), `${check}: at 375 px, "No, keep planning" must start at the left edge of the card.`).toBeLessThanOrEqual(2)
    expect(Math.abs(n3.width - narrow.width), `${check}: at 375 px, "No, keep planning" must take the full width of the card.`).toBeLessThanOrEqual(2)
    expect(Math.abs(n1.height - n3.height), `${check}: at 375 px, the stacked buttons must have the same height.`).toBeLessThanOrEqual(1)

    await main1.click()
    await reach(chat.control.waitForPermission(plan.id), `${check}: the agent got no answer.`)
  })

  test('S5-20: after "Allow" the card stays with no buttons, the question secondary and "Allow" primary, also after a restart; Stop on an open card shows "Not answered: you pressed Stop."', async ({
    chat
  }) => {
    const check = 'S5-20'
    const run: Ask = { id: 'run-tests', title: 'npm test', kind: 'execute' }
    const read: Ask = { id: 'read-notes', title: 'Read notes.txt', kind: 'read' }
    const page = await startWith(chat, [ask(run), answers, say('The tests ran.'), ask(read), answers, say('Not sent.')], check)
    await expect(openDecision(page, run.title), `${check}: the agent asked a permission, but no card "Permission request" shows.`).toHaveCount(1)

    await buttonIn(openDecision(page, run.title), 'Allow').click()
    await reach(chat.control.waitForPermission(run.id), `${check}: the agent got no answer.`)
    const expectAllowed = async (on: Page, when: string) => {
      const card = answeredDecisions(on).filter({ hasText: QUESTION_OF.execute })
      await expect(card, `${check}${when}: after "Allow", no card "Permission answered" shows the question "${QUESTION_OF.execute}".`).toHaveCount(1)
      await expect(card.getByRole('button'), `${check}${when}: the answered card must show no button, also no disabled one.`).toHaveCount(0)
      const question = card.getByText(QUESTION_OF.execute, { exact: true })
      const answer = card.getByText('Allow', { exact: true })
      await expect(answer, `${check}${when}: the answered card must show the chosen answer "Allow".`).toBeVisible()
      expect(await colorOf(question), `${check}${when}: the question must have the secondary color (--muted).`).toBe(await resolvedColor(on, 'var(--muted)'))
      expect(await colorOf(answer), `${check}${when}: the answer "Allow" must have the primary color (--text).`).toBe(await resolvedColor(on, 'var(--text)'))
    }
    await expectAllowed(page, '')

    // Stop on the next open card.
    await expect(openDecision(page, read.title), `${check}: the second request shows no card.`).toHaveCount(1)
    await stopButton(page).click()
    await reach(chat.control.waitForPermission(read.id), `${check}: the agent got no answer after Stop.`)
    const expectStopped = async (on: Page, when: string) => {
      const card = answeredDecisions(on).filter({ hasText: QUESTION_OF.read })
      await expect(card, `${check}${when}: after Stop, no card "Permission answered" shows the question "${QUESTION_OF.read}".`).toHaveCount(1)
      await expect(card, `${check}${when}: the card that Stop closed must show "${NOT_ANSWERED.stopped}".`).toContainText(NOT_ANSWERED.stopped)
      await expect(card.getByRole('button'), `${check}${when}: the card that Stop closed must show no button.`).toHaveCount(0)
    }
    await expectStopped(page, '')
    await expect(stopButton(page), `${check}: the turn does not end after Stop.`).toHaveCount(0)

    const again = await restartAndOpen(chat, TITLE, check)
    await expectAllowed(again, ' (after a restart)')
    await expectStopped(again, ' (after a restart)')
    await expect(openDecisions(again), `${check} (after a restart): a card "Permission request" is open again.`).toHaveCount(0)
  })

  test('S5-27: while the answer is sent the card shows the answered layout with a spinner and no button, as "Permission request"; it becomes "Permission answered"; a refused answer brings the buttons back with the error line', async ({
    chat
  }) => {
    const check = 'S5-27'
    const first: Ask = { id: 'run-tests', title: 'npm test', kind: 'execute' }
    const second: Ask = { id: 'edit-math', title: 'Edit src\\math.ts', kind: 'edit' }
    const page = await startWith(chat, [ask(first, second), answers, say('Both answered.')], check)
    await expect(openDecisions(page), `${check}: the agent asked two permissions, but the log does not show two cards "Permission request".`).toHaveCount(2)
    await page.emulateMedia({ reducedMotion: 'no-preference' })

    // The answer waits in the main process until the test releases it.
    await holdAnswers(chat, 'sessions.answer-permission')
    // While the answer is sent, the card may show only its question and the chosen label, so the test finds it by its question.
    const card = openDecisions(page).filter({ hasText: QUESTION_OF.execute })
    await expect(card, `${check}: the card of "${first.title}" does not show the question "${QUESTION_OF.execute}".`).toHaveCount(1)
    await buttonIn(card, 'Allow').click()
    await expect.poll(() => heldCalls(chat), { message: `${check}: "Allow" did not call sessions.answer-permission.` }).toBe(1)
    await expect(card, `${check}: while the answer is sent, the card must keep the name "Permission request".`).toHaveCount(1)
    await expect(card.getByRole('button'), `${check}: while the answer is sent, the card must show no button, also no disabled one.`).toHaveCount(0)
    await expect(card.getByText('Allow', { exact: true }), `${check}: while the answer is sent, the card must show the chosen label "Allow".`).toBeVisible()
    await expect.poll(() => animates(card), { message: `${check}: while the answer is sent, the card shows no spinner.` }).toBe(true)
    expect(chat.control.permissionAnswers, `${check}: the agent got the answer before main took it.`).toEqual([])

    await releaseAnswers(chat)
    expect(await reach(chat.control.waitForPermission(first.id), `${check}: the agent got no answer after the release.`)).toEqual({
      id: first.id,
      outcome: { outcome: 'selected', optionId: 'yes' }
    })
    const answered = answeredDecisions(page).filter({ hasText: QUESTION_OF.execute })
    await expect(answered, `${check}: after main accepted the answer, the card must become "Permission answered".`).toHaveCount(1)
    await expect.poll(() => animates(answered), { message: `${check}: the spinner stays after main accepted the answer.` }).toBe(false)

    // A refusal: the held call goes on with an option that the request did not offer.
    await holdAnswers(chat, 'sessions.answer-permission', 'not-offered')
    const other = openDecisions(page).filter({ hasText: QUESTION_OF.edit })
    await expect(other, `${check}: the card of "${second.title}" does not show the question "${QUESTION_OF.edit}".`).toHaveCount(1)
    await buttonIn(other, 'Allow').click()
    await expect.poll(() => heldCalls(chat), { message: `${check}: "Allow" on the second card did not call sessions.answer-permission.` }).toBe(1)
    await expect(other.getByRole('button'), `${check}: while the second answer is sent, the card must show no button.`).toHaveCount(0)
    await releaseAnswers(chat)
    await expect(buttonIn(other, 'Allow'), `${check}: after main refused the answer, the card must show its buttons again.`).toBeEnabled()
    await expect(buttonIn(other, 'Refuse'), `${check}: after main refused the answer, "Refuse" must work again.`).toBeEnabled()
    await expect(other, `${check}: after main refused the answer, the card must show the error "Aether cannot send this answer.".`).toContainText(
      'Aether cannot send this answer.'
    )
    expect(chat.control.permissionAnswers.map(({ id }) => id), `${check}: a refused answer reached the agent.`).toEqual([first.id])

    await stopHolding(chat)
    await buttonIn(other, 'Refuse').click()
    expect(await reach(chat.control.waitForPermission(second.id), `${check}: the agent got no answer after the refusal.`)).toEqual({
      id: second.id,
      outcome: { outcome: 'selected', optionId: 'no' }
    })
    await expect(main(page).getByText('Both answered.', { exact: true }), `${check}: the turn does not go on after both answers.`).toBeVisible()
  })
})

