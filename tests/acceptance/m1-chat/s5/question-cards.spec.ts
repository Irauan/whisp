// S5-9, S5-10, S5-21, S5-22 and S5-23 of milestone m1-chat: the question cards of Claude
// (AskUserQuestion as a form elicitation), on the built app.
//
// S5-9: `initialize` declares form elicitation. The agent sends a single select question. The card
// shows one radio row for each option, in the order of the agent, with its explanation. A row click
// and "Submit" send `accept` with that `const`.
// S5-10: a multi select question with "Other": the user checks two option rows and the "Other" row,
// types a text and submits. The agent receives the array and the custom text.
// S5-21: the user answers a single select and a multi select with "Other". The card turns into the
// answered card "Claude asked", with one row for each question and the answer below it. After a
// restart it shows the same.
// S5-22: a question with no pick shows "Not answered: you skipped it.". Skip of the whole form shows
// "Not answered: you skipped it." in each row. Stop on an open question card shows "Not answered: you
// pressed Stop." in each row.
// S5-23: a click on an option row selects it and sends nothing. "Submit" is disabled until a pick or
// a text. No row is preselected.
//
// User decisions, 2026-11-27 (spec, "The question card" and "The answered card"): radio rows for one
// choice, check rows for many, each with its explanation, nothing preselected, "Submit" and "Skip".
// The request has the shape of the Claude Code adapter 0.112.0 (`elicitation.js`): the fields
// `question_<n>` and `question_<n>_custom`, the option label as `const` and `title`, and the
// explanation as `description`. `fixture.ts` describes the UI contract. No test sleeps.
import type { Locator, Page } from '@playwright/test'
import {
  answeredQuestions,
  answers,
  askOneQuestion,
  askQuestions,
  askUserQuestionTool,
  buttonIn,
  colorOf,
  DRAFT_IN_REPO_A,
  elicit,
  expect,
  inOrder,
  main,
  NOT_ANSWERED,
  openQuestions,
  reach,
  resolvedColor,
  restartAndOpen,
  say,
  startImported,
  startSession,
  stopButton,
  test,
  writeOldProfile,
  type ChatApp,
  type Choice
} from './fixture'

const TITLE = 'Set up the test runner'

const RUNNERS: Choice[] = [
  { label: 'Vitest (Recommended)', description: 'Fast, and the project already uses Vite.' },
  { label: 'Jest', description: 'Widely used. Needs a transform for ESM.' },
  { label: 'Node test runner', description: 'No extra package. Fewer features.' }
]
const REPORTS: Choice[] = [
  { label: 'Coverage', description: 'Lines and branches, as text and lcov.' },
  { label: 'JUnit XML', description: 'For the CI test view.' },
  { label: 'HTML', description: 'A local report to open in the browser.' }
]
const RUNNER_QUESTION = 'Which test runner do you want?'
const REPORT_QUESTION = 'Which reports do you want?'
const WATCH_QUESTION = 'Run the tests on each save?'
const WATCH: Choice[] = [
  { label: 'Yes (Recommended)', description: 'Faster feedback while you work.' },
  { label: 'No', description: 'Run the tests on demand only.' }
]

async function startWith(chat: ChatApp, prompt: unknown[], check: string): Promise<Page> {
  await chat.control.scenario('steps', { prompt })
  await writeOldProfile(chat, [DRAFT_IN_REPO_A])
  const page = await startImported(chat)
  await startSession(page, TITLE, check)
  return page
}

/** Checks that the open question card shows its rows in the order of the agent, each with its explanation. */
async function expectRows(group: Locator, role: 'radio' | 'checkbox', choices: Choice[], check: string): Promise<void> {
  const rows = group.getByRole(role)
  await expect(rows, `${check}: the question must show one ${role} row for each option, then the row "Other".`).toHaveCount(choices.length + 1)
  for (const [index, choice] of choices.entries()) {
    await expect(rows.nth(index), `${check}: row ${index + 1} must be the option "${choice.label}" of the agent, named by its label only.`).toHaveAccessibleName(choice.label)
    await expect(rows.nth(index), `${check}: the row "${choice.label}" must show its explanation "${choice.description}" as its description.`).toHaveAccessibleDescription(
      choice.description ?? ''
    )
    await expect(rows.nth(index), `${check}: the row "${choice.label}" must not be preselected.`).not.toBeChecked()
  }
  await expect(rows.last(), `${check}: the last row must be "Other".`).toHaveAccessibleName('Other')
}

test.describe('S5-9, S5-10, S5-21, S5-22 and S5-23: the question cards of Claude', () => {
  test('S5-9: initialize declares form elicitation; a single select shows one radio row for each option, in order, with its explanation; a row click and "Submit" send accept with that const', async ({
    chat
  }) => {
    const check = 'S5-9'
    const page = await startWith(
      chat,
      [askUserQuestionTool('ask-runner'), elicit('runner', askOneQuestion('ask-runner', { header: 'Runner', text: RUNNER_QUESTION, options: RUNNERS })), answers, say('I set up Jest.')],
      check
    )
    // The capability: form elicitation, and no URL elicitation.
    await expect.poll(() => chat.control.received('initialize').length, { message: `${check}: the agent got no initialize.` }).toBe(1)
    const capabilities = (chat.control.received('initialize')[0]!.params as { clientCapabilities?: { elicitation?: unknown } }).clientCapabilities
    expect(capabilities?.elicitation, `${check}: initialize must declare clientCapabilities.elicitation = { form: {} }, and no url.`).toEqual({ form: {} })

    const card = openQuestions(page)
    await expect(card, `${check}: the agent asked a question, but the log shows no card "Claude asks".`).toHaveCount(1)
    await expect(card, `${check}: the card must show the question "${RUNNER_QUESTION}".`).toContainText(RUNNER_QUESTION)
    const group = card.getByRole('radiogroup')
    await expect(group, `${check}: a single select must be a radiogroup.`).toHaveCount(1)
    await expectRows(group, 'radio', RUNNERS, check)

    // A click on the explanation of the row "Jest" selects the row.
    await card.getByText(RUNNERS[1]!.description!, { exact: true }).click()
    await expect(group.getByRole('radio', { name: 'Jest', exact: true }), `${check}: a click on the row "Jest" does not select it.`).toBeChecked()
    expect(chat.control.elicitationAnswers, `${check}: a row click sent an answer.`).toEqual([])
    await buttonIn(card, 'Submit').click()
    expect(await reach(chat.control.waitForElicitation('runner'), `${check}: "Submit" sent no answer to the agent.`), `${check}: "Submit" must send accept with the const of "Jest" only.`).toEqual({
      id: 'runner',
      response: { action: 'accept', content: { question_0: 'Jest' } }
    })
    await expect(main(page).getByText('I set up Jest.', { exact: true }), `${check}: the turn does not go on after the answer.`).toBeVisible()
  })

  test('S5-10: a multi select with "Other": two checked rows, the checked row "Other" and its text reach the agent as the array and the custom text', async ({
    chat
  }) => {
    const check = 'S5-10'
    const page = await startWith(
      chat,
      [askUserQuestionTool('ask-reports'), elicit('reports', askOneQuestion('ask-reports', { header: 'Reports', text: REPORT_QUESTION, multi: true, options: REPORTS })), answers, say('Reports set.')],
      check
    )
    const card = openQuestions(page)
    await expect(card, `${check}: the agent asked a question, but the log shows no card "Claude asks".`).toHaveCount(1)
    const group = card.getByRole('group').filter({ has: page.getByRole('checkbox') })
    await expect(group, `${check}: a multi select must be a group of checkbox rows.`).toHaveCount(1)
    await expect(card.getByRole('radio'), `${check}: a multi select must show no radio.`).toHaveCount(0)
    await expectRows(group, 'checkbox', REPORTS, check)

    await card.getByText(REPORTS[0]!.description!, { exact: true }).click()
    await card.getByText(REPORTS[2]!.description!, { exact: true }).click()
    await group.getByRole('checkbox', { name: 'Other', exact: true }).check()
    const other = card.getByRole('textbox', { name: 'Other', exact: true })
    await expect(other, `${check}: the row "Other" has no text field "Other".`).toBeEditable()
    await other.fill('A summary in the console')
    for (const label of ['Coverage', 'HTML', 'Other']) {
      await expect(group.getByRole('checkbox', { name: label, exact: true }), `${check}: the row "${label}" is not checked.`).toBeChecked()
    }
    await expect(group.getByRole('checkbox', { name: 'JUnit XML', exact: true }), `${check}: the row "JUnit XML" must stay unchecked.`).not.toBeChecked()
    expect(chat.control.elicitationAnswers, `${check}: a row click sent an answer.`).toEqual([])

    await buttonIn(card, 'Submit').click()
    const answer = await reach(chat.control.waitForElicitation('reports'), `${check}: "Submit" sent no answer to the agent.`)
    expect(answer.response?.action, `${check}: "Submit" must send accept.`).toBe('accept')
    const content = (answer.response as { content?: Record<string, unknown> }).content ?? {}
    expect(Array.isArray(content.question_0) ? [...(content.question_0 as string[])].sort() : content.question_0, `${check}: the agent must receive the two checked options as an array.`).toEqual([
      'Coverage',
      'HTML'
    ])
    expect(content.question_0_custom, `${check}: the agent must receive the text of "Other" as question_0_custom.`).toBe('A summary in the console')
    await expect(main(page).getByText('Reports set.', { exact: true }), `${check}: the turn does not go on after the answer.`).toBeVisible()
  })

  test('S5-23: a row click selects it and sends nothing; "Submit" is disabled until a pick or a text; no row is preselected', async ({ chat }) => {
    const check = 'S5-23'
    const page = await startWith(
      chat,
      [
        askUserQuestionTool('ask-runner'),
        elicit('runner', askOneQuestion('ask-runner', { header: 'Runner', text: RUNNER_QUESTION, options: RUNNERS })),
        answers,
        askUserQuestionTool('ask-watch'),
        elicit('watch', askOneQuestion('ask-watch', { header: 'Watch', text: WATCH_QUESTION, options: WATCH })),
        answers,
        say('Done.')
      ],
      check
    )
    const card = openQuestions(page)
    await expect(card, `${check}: the agent asked a question, but the log shows no card "Claude asks".`).toHaveCount(1)
    for (const label of [...RUNNERS.map(({ label }) => label), 'Other']) {
      await expect(card.getByRole('radio', { name: label, exact: true }), `${check}: the row "${label}" is preselected.`).not.toBeChecked()
    }
    await expect(buttonIn(card, 'Submit'), `${check}: "Submit" must be disabled before a pick or a text.`).toBeDisabled()
    await expect(buttonIn(card, 'Skip'), `${check}: the card has no button "Skip".`).toBeEnabled()

    // A row click selects the row and sends nothing.
    await card.getByText(RUNNERS[2]!.label, { exact: true }).click()
    await expect(card.getByRole('radio', { name: RUNNERS[2]!.label, exact: true }), `${check}: a click on the row does not select it.`).toBeChecked()
    await expect(card, `${check}: a row click closed the card.`).toHaveCount(1)
    expect(chat.control.elicitationAnswers, `${check}: a row click sent an answer to the agent.`).toEqual([])
    await expect(buttonIn(card, 'Submit'), `${check}: "Submit" must be enabled after a pick.`).toBeEnabled()
    await buttonIn(card, 'Submit').click()
    expect(await reach(chat.control.waitForElicitation('runner'), `${check}: "Submit" sent no answer.`)).toEqual({
      id: 'runner',
      response: { action: 'accept', content: { question_0: RUNNERS[2]!.label } }
    })

    // A text alone also enables "Submit".
    const watch = openQuestions(page)
    await expect(watch, `${check}: the second question shows no card "Claude asks".`).toHaveCount(1)
    await expect(watch, `${check}: the second card must show "${WATCH_QUESTION}".`).toContainText(WATCH_QUESTION)
    await expect(buttonIn(watch, 'Submit'), `${check}: "Submit" of the second card must be disabled before a pick or a text.`).toBeDisabled()
    await watch.getByRole('textbox', { name: 'Other', exact: true }).fill('Only for the parser tests')
    await expect(buttonIn(watch, 'Submit'), `${check}: "Submit" must be enabled after a text in "Other".`).toBeEnabled()
    await buttonIn(watch, 'Skip').click()
    expect(await reach(chat.control.waitForElicitation('watch'), `${check}: "Skip" sent no answer.`)).toEqual({ id: 'watch', response: { action: 'decline' } })
  })

  test('S5-21: a single select and a multi select with "Other" turn into the answered card "Claude asked", one row per question with the answer below, also after a restart', async ({
    chat
  }) => {
    const check = 'S5-21'
    const form = askQuestions('ask-setup', [
      { header: 'Runner', text: RUNNER_QUESTION, options: RUNNERS },
      { header: 'Reports', text: REPORT_QUESTION, multi: true, options: REPORTS }
    ])
    const page = await startWith(chat, [askUserQuestionTool('ask-setup'), elicit('setup', form), answers, say('I set up Vitest.')], check)
    const card = openQuestions(page)
    await expect(card, `${check}: the agent asked two questions, but the log shows no card "Claude asks".`).toHaveCount(1)
    await expect(card, `${check}: the card must show the text of each question.`).toContainText(inOrder(RUNNER_QUESTION, REPORT_QUESTION))

    const runner = card.getByRole('radiogroup')
    const reports = card.getByRole('group').filter({ has: page.getByRole('checkbox') })
    await runner.getByRole('radio', { name: RUNNERS[0]!.label, exact: true }).check()
    await reports.getByRole('checkbox', { name: 'Coverage', exact: true }).check()
    await reports.getByRole('checkbox', { name: 'JUnit XML', exact: true }).check()
    await reports.getByRole('checkbox', { name: 'Other', exact: true }).check()
    await reports.getByRole('textbox', { name: 'Other', exact: true }).fill('A summary in the console')
    await buttonIn(card, 'Submit').click()
    const answer = await reach(chat.control.waitForElicitation('setup'), `${check}: "Submit" sent no answer.`)
    expect(answer.response, `${check}: the agent must get the picks and the text.`).toMatchObject({
      action: 'accept',
      content: { question_0: RUNNERS[0]!.label, question_1_custom: 'A summary in the console' }
    })

    const expectAnswered = async (on: Page, when: string) => {
      const answered = answeredQuestions(on)
      await expect(answered, `${check}${when}: after "Submit", the log shows no card "Claude asked".`).toHaveCount(1)
      await expect(openQuestions(on), `${check}${when}: the card "Claude asks" is still open.`).toHaveCount(0)
      await expect(answered.getByRole('button'), `${check}${when}: the answered card must show no button.`).toHaveCount(0)
      await expect(answered, `${check}${when}: the answered card must show each question with its answer below it, in order.`).toContainText(
        inOrder(RUNNER_QUESTION, RUNNERS[0]!.label, REPORT_QUESTION, 'Coverage, JUnit XML, A summary in the console')
      )
      const muted = await resolvedColor(on, 'var(--muted)')
      const text = await resolvedColor(on, 'var(--text)')
      expect(await colorOf(answered.getByText(REPORT_QUESTION, { exact: true })), `${check}${when}: the question must have the secondary color.`).toBe(muted)
      expect(
        await colorOf(answered.getByText('Coverage, JUnit XML, A summary in the console', { exact: true })),
        `${check}${when}: the answer must have the primary color.`
      ).toBe(text)
    }
    await expect(main(page).getByText('I set up Vitest.', { exact: true }), `${check}: the turn does not go on after the answer.`).toBeVisible()
    await expectAnswered(page, '')
    const again = await restartAndOpen(chat, TITLE, check)
    await expectAnswered(again, ' (after a restart)')
  })

  test('S5-22: a question with no pick, a skipped form and a stopped form show the reason in each row', async ({ chat }) => {
    const check = 'S5-22'
    const two = (id: string) =>
      askQuestions(id, [
        { header: 'Runner', text: RUNNER_QUESTION, options: RUNNERS },
        { header: 'Watch', text: WATCH_QUESTION, options: WATCH }
      ])
    const page = await startWith(
      chat,
      [
        askUserQuestionTool('ask-1'),
        elicit('partly', two('ask-1')),
        answers,
        askUserQuestionTool('ask-2'),
        elicit('skipped', two('ask-2')),
        answers,
        askUserQuestionTool('ask-3'),
        elicit('stopped', two('ask-3')),
        answers,
        say('Not sent.')
      ],
      check
    )

    // A submitted form with one question left empty.
    let card = openQuestions(page)
    await expect(card, `${check}: the agent asked a question, but the log shows no card "Claude asks".`).toHaveCount(1)
    await card.getByRole('radio', { name: RUNNERS[1]!.label, exact: true }).check()
    await buttonIn(card, 'Submit').click()
    await reach(chat.control.waitForElicitation('partly'), `${check}: "Submit" sent no answer.`)
    const partly = answeredQuestions(page).first()
    await expect(partly, `${check}: the submitted form must show the answer of the first question.`).toContainText(inOrder(RUNNER_QUESTION, RUNNERS[1]!.label))
    await expect(partly, `${check}: the question with no pick must show "${NOT_ANSWERED.skipped}".`).toContainText(inOrder(WATCH_QUESTION, NOT_ANSWERED.skipped))

    // Skip of the whole form.
    card = openQuestions(page)
    await expect(card, `${check}: the second form shows no card "Claude asks".`).toHaveCount(1)
    await buttonIn(card, 'Skip').click()
    expect(await reach(chat.control.waitForElicitation('skipped'), `${check}: "Skip" sent no answer.`)).toEqual({ id: 'skipped', response: { action: 'decline' } })
    const skipped = answeredQuestions(page).nth(1)
    await expect(skipped, `${check}: after "Skip", each row must show "${NOT_ANSWERED.skipped}".`).toContainText(
      inOrder(RUNNER_QUESTION, NOT_ANSWERED.skipped, WATCH_QUESTION, NOT_ANSWERED.skipped)
    )

    // Stop on an open question card.
    card = openQuestions(page)
    await expect(card, `${check}: the third form shows no card "Claude asks".`).toHaveCount(1)
    await stopButton(page).click()
    expect(await reach(chat.control.waitForElicitation('stopped'), `${check}: Stop sent no answer.`)).toEqual({ id: 'stopped', response: { action: 'cancel' } })
    const stopped = answeredQuestions(page).nth(2)
    await expect(stopped, `${check}: after Stop, each row must show "${NOT_ANSWERED.stopped}".`).toContainText(
      inOrder(RUNNER_QUESTION, NOT_ANSWERED.stopped, WATCH_QUESTION, NOT_ANSWERED.stopped)
    )
    await expect(answeredQuestions(page), `${check}: the log must hold three answered cards.`).toHaveCount(3)
    await expect(openQuestions(page), `${check}: a card "Claude asks" is still open after Stop.`).toHaveCount(0)
  })
})
