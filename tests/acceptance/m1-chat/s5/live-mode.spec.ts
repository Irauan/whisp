// S5-7 and S5-15 of milestone m1-chat: the live mode after a plan exit, and the refusal fallback, on
// the built app.
//
// S5-7: the agent reports the mode `accept-edits` after a plan exit. The Mode control shows
// "Accept edits". After a restart, the session starts in `accept-edits`.
// S5-15: the refusal fallback dialog shows "Keep the refusal" first and primary. "Retry with
// <fallback>" sends `accept`. The agent reports the new model. The model button shows it, and after a
// restart the session starts with it.
//
// User decisions, 2026-11-27 (spec, "Live mode", open choice 5, and decision A of "Questions of the
// agent"): Aether shows and saves the live mode; "Keep the refusal" is primary; a retry saves the new
// model. The plan exit has the options of the Claude Code adapter 0.112.0 for a session with no auto
// mode (`permissions/options/tools.js`). The refusal fallback has the form of `elicitation.js`. The
// simulated agent changes its mode or its model as the adapter does, and reports it with
// `current_mode_update` or `config_option_update`. `fixture.ts` describes the UI contract. No test sleeps.
import {
  answers,
  ask,
  buttonIn,
  buttonNames,
  chooseMode,
  chooseModel,
  DRAFT_IN_REPO_A,
  elicit,
  expect,
  expectInTranscript,
  expectMode,
  expectPrimary,
  modelButton,
  ofProcess,
  openDecision,
  openQuestions,
  paramsOf,
  PLAN_EXIT_OPTIONS,
  QUESTION_OF,
  reach,
  restartAndOpen,
  say,
  send,
  startImported,
  startSession,
  stopButton,
  test,
  writeOldProfile,
  type ChatApp
} from './fixture'

/** The settings that one agent process got before its first prompt: the Claude modes and the models. */
function settingsBeforePrompt(chat: ChatApp, pid: number) {
  const messages = chat.control.processMessages.filter((entry) => entry.pid === pid).map(({ message }) => message)
  const index = messages.findIndex((message) => message.method === 'session/prompt')
  const before = index < 0 ? messages : messages.slice(0, index)
  return {
    modes: before.filter((message) => message.method === 'session/set_mode').map((message) => paramsOf(message).modeId),
    models: before
      .filter((message) => message.method === 'session/set_config_option' && paramsOf(message).configId === 'model')
      .map((message) => paramsOf(message).value)
  }
}

/** After a restart: sends a message, and returns the process ID of the new agent process once it got the prompt. */
async function sendAfterRestart(chat: ChatApp, page: Parameters<typeof send>[0], check: string): Promise<number> {
  await chat.control.scenario('text', { chunks: ['Welcome ', 'back.'] })
  await send(page, 'Go on', check)
  await expectInTranscript(page, 'Welcome back.', `${check}: the message after the restart gets no reply.`)
  await expect.poll(() => chat.control.pids.length, { message: `${check}: the message after the restart started no new agent process.` }).toBe(2)
  const pid = chat.control.pids[1]!
  await expect
    .poll(() => ofProcess(chat.control.receivedBy('session/prompt'), pid).length, { message: `${check}: the new agent process got no prompt.` })
    .toBe(1)
  return pid
}

test.describe('S5-7 and S5-15: the live mode and the refusal fallback', () => {
  test('S5-7: after the plan exit "Yes, auto-accept edits" the agent reports acceptEdits, the Mode control shows "Accept edits", and after a restart the session starts in acceptEdits', async ({
    chat
  }) => {
    const check = 'S5-7'
    const plan = {
      id: 'plan',
      title: 'Approve Plan',
      kind: 'switch_mode',
      options: PLAN_EXIT_OPTIONS,
      modes: { 'exit-plan-accept-edits': 'acceptEdits', 'exit-plan-default': 'default' }
    }
    await chat.control.scenario('steps', { prompt: [say('The plan is ready.'), ask(plan), answers, say('I start with the first step.')] })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    let page = await startImported(chat)
    await chooseMode(page, 'plan', check)
    await startSession(page, 'Plan the change', check)

    const card = openDecision(page, plan.title)
    await expect(card, `${check}: the agent asked to exit the plan, but no card "Permission request" shows.`).toHaveCount(1)
    await expect(card, `${check}: the plan exit card must ask "${QUESTION_OF.switch_mode}".`).toContainText(QUESTION_OF.switch_mode)
    await expectMode(page, 'plan', `${check}: before the answer, the Mode control must show Plan.`)
    await buttonIn(card, 'More allow options').click()
    await page.getByRole('menu').getByRole('menuitem', { name: 'Yes, auto-accept edits', exact: true }).click()
    expect(await reach(chat.control.waitForPermission(plan.id), `${check}: the agent got no answer to the plan exit.`)).toEqual({
      id: plan.id,
      outcome: { outcome: 'selected', optionId: 'exit-plan-accept-edits' }
    })
    await expectInTranscript(page, 'I start with the first step.', `${check}: the turn does not go on after the plan exit.`)
    await expectMode(page, 'accept-edits', `${check}: the agent reported acceptEdits, but the Mode control does not show "Accept edits".`)
    await expect(stopButton(page), `${check}: the turn does not end.`).toHaveCount(0)

    // The live mode is saved: after a restart the window shows it, and a new process starts in it.
    page = await restartAndOpen(chat, 'Plan the change', check)
    await expectMode(page, 'accept-edits', `${check}: after a restart, the Mode control must show the saved live mode "Accept edits".`)
    const pid = await sendAfterRestart(chat, page, check)
    expect(settingsBeforePrompt(chat, pid).modes.at(-1), `${check}: after a restart, the new agent process must start in acceptEdits.`).toBe('acceptEdits')
  })

  test('S5-15: the refusal fallback shows "Keep the refusal" first and primary; "Retry with claude-opus-5-5" sends accept; the model button shows Opus 5.5, also after a restart, and the next process starts with it', async ({
    chat
  }) => {
    const check = 'S5-15'
    const message = 'claude-fable-5-2 declined this request. Retry with claude-opus-5-5?'
    const fallback = elicit(
      'fallback',
      {
        message,
        requestedSchema: {
          type: 'object',
          properties: {
            choice: {
              type: 'string',
              oneOf: [
                { const: 'retry_fallback', title: 'Retry with claude-opus-5-5', description: 'The session continues on claude-opus-5-5.' },
                { const: 'cancelled', title: 'Keep the refusal', description: 'You can send a new message.' }
              ]
            }
          }
        }
      },
      { fallbackModel: 'claude-opus-5-5' }
    )
    await chat.control.scenario('steps', { prompt: [fallback, answers, say('Retried on the fallback model.')] })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    let page = await startImported(chat)
    await chooseModel(page, 'Fable 5.2', check)
    await startSession(page, 'Review the change', check)

    const card = openQuestions(page)
    await expect(card, `${check}: the agent sent the refusal fallback dialog, but the log shows no card "Claude asks".`).toHaveCount(1)
    await expect(card, `${check}: the card must show the message of the agent.`).toContainText(message)
    expect(await buttonNames(card), `${check}: the card must show "Keep the refusal" first, then "Retry with claude-opus-5-5", and no other button.`).toEqual([
      'Keep the refusal',
      'Retry with claude-opus-5-5'
    ])
    await expectPrimary(page, buttonIn(card, 'Keep the refusal'), true, `${check}: "Keep the refusal" must be the primary button.`)
    await expectPrimary(page, buttonIn(card, 'Retry with claude-opus-5-5'), false, `${check}: "Retry with claude-opus-5-5" must not be primary.`)
    await expect(modelButton(page), `${check}: before the retry, the model button must show Fable 5.2.`).toHaveText('Fable 5.2')

    await buttonIn(card, 'Retry with claude-opus-5-5').click()
    expect(await reach(chat.control.waitForElicitation('fallback'), `${check}: "Retry with claude-opus-5-5" sent no answer.`)).toEqual({
      id: 'fallback',
      response: { action: 'accept', content: { choice: 'retry_fallback' } }
    })
    await expectInTranscript(page, 'Retried on the fallback model.', `${check}: the turn does not go on after the retry.`)
    await expect(modelButton(page), `${check}: the agent reported the model claude-opus-5-5, but the model button does not show "Opus 5.5".`).toHaveText('Opus 5.5')
    await expect(stopButton(page), `${check}: the turn does not end.`).toHaveCount(0)

    // The model is saved: sessions.open, the model button after a restart, and the next process.
    page = await restartAndOpen(chat, 'Review the change', check)
    await expect(modelButton(page), `${check}: after a restart, the model button must show the saved model "Opus 5.5".`).toHaveText('Opus 5.5')
    const pid = await sendAfterRestart(chat, page, check)
    expect(settingsBeforePrompt(chat, pid).models, `${check}: after a restart, the new agent process must start with the model claude-opus-5-5.`).toEqual([
      'claude-opus-5-5'
    ])
  })
})
