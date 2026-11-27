// S8-6 and S8-7 of milestone m1-chat: the model button of the session window, on the built app.
//
// S8-6: in a draft, the user picks another model with the model button. The first start sends that
// model to the agent.
// S8-7 (acceptance part): after the first message, the model button is disabled.
// `sessions.set-model` answers `session-started`. The slice test of S8-7 is a unit test of the builder.
// Spec, "The composer" and "Contract `sessions.set-model`" (user decision C, 2026-11-27): the model
// button is enabled in a draft until the first message, like Mode. A choice saves the model with
// `sessions.set-model`. The start reads the model from the session row.
//
// The model reaches the agent as in S7: `session/set_config_option` with `configId` "model",
// before the first `session/prompt`. `frame.ts` describes the UI contract. No test sleeps.
import type { Page } from '@playwright/test'
import { DRAFT_IN_REPO_A, expect, expectInTranscript, promptField, sendButton, sessionEntry, startImported, startSession, stopButton, test, writeOldProfile } from './fixture'
import { modelButton } from './frame'
import { chooseModel, invoke, MODEL_IDS, settingsBeforeFirstPrompt, type Answer } from '../s7/fixture'

const REPLY = 'Hello from the agent.'

/** The session with this title, from `sessions.list` of the current profile. */
async function sessionNamed(page: Page, title: string, check: string): Promise<{ id: string; model: string }> {
  const profiles = await invoke(page, 'profiles.list', {})
  if (!profiles.ok) throw new Error(`${check}: profiles.list failed: ${profiles.error.message}`)
  const sessions = await invoke(page, 'sessions.list', { profileId: profiles.value.currentId })
  if (!sessions.ok) throw new Error(`${check}: sessions.list failed: ${sessions.error.message}`)
  const session = (sessions.value.sessions as { id: string; title: string; model: string }[]).find((item) => item.title === title)
  if (!session) throw new Error(`${check}: sessions.list has no session "${title}".`)
  return session
}

/** Calls a contract and returns its answer. A call that throws becomes an error answer, so the check can name it. */
async function answerOf(page: Page, name: string, input: unknown): Promise<Answer> {
  try {
    return await invoke(page, name, input)
  } catch (error) {
    return { ok: false, error: { code: 'thrown', message: String(error) } }
  }
}

test.describe('S8 model button', () => {
  test('S8-6: in a draft, the user picks Opus 5.5 with the model button, and the first start sends that model to the agent', async ({ chat }) => {
    const check = 'S8-6'
    await chat.control.scenario('text', { chunks: ['Hello ', 'from the agent.'] })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)

    // The imported draft opens with its prompt and the model Default.
    const entry = sessionEntry(page, DRAFT_IN_REPO_A.prompt)
    await expect(entry, `${check}: the sidebar does not list the draft "${DRAFT_IN_REPO_A.prompt}".`).toBeVisible()
    await entry.click()
    await expect(entry, `${check}: the draft does not open.`).toHaveAttribute('aria-current', 'page')
    await expect(promptField(page), `${check}: the composer of the draft does not hold its prompt.`).toHaveValue(DRAFT_IN_REPO_A.prompt)
    await expect(modelButton(page), `${check}: the session window of the draft has no model button "Model".`).toBeVisible()
    await expect(modelButton(page), `${check}: the model button of a draft must be enabled until the first message.`).toBeEnabled()
    await expect(modelButton(page), `${check}: the model button must show the model of the draft, "Default".`).toHaveText('Default')

    // The user picks Opus 5.5. The draft saves it with sessions.set-model.
    await chooseModel(page, 'Opus 5.5', check)
    await expect
      .poll(async () => (await sessionNamed(page, DRAFT_IN_REPO_A.prompt, check)).model, {
        message: `${check}: the choice of the model button is not saved: sessions.list does not show the model ${MODEL_IDS['Opus 5.5']}.`
      })
      .toBe(MODEL_IDS['Opus 5.5'])

    // Send starts the draft. The agent gets the model before the first message.
    await expect(sendButton(page), `${check}: "Send" of the draft is not enabled.`).toBeEnabled()
    await sendButton(page).click()
    await expectInTranscript(page, REPLY, `${check}: the draft gets no reply.`)
    await expect.poll(() => chat.control.received('session/prompt').length, { message: `${check}: the agent got no prompt.` }).toBe(1)
    expect(
      settingsBeforeFirstPrompt(chat).models,
      `${check}: the model of the model button must reach the agent as the configuration option "model" before the first message.`
    ).toEqual([MODEL_IDS['Opus 5.5']])
  })

  test('S8-7: after the first message, the model button shows the model of the session and is disabled', async ({ chat }) => {
    const check = 'S8-7, the model button'
    await chat.control.scenario('text', { chunks: ['Hello ', 'from the agent.'] })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    await chooseModel(page, 'Opus 5.5', check)
    await startSession(page, 'Say hello', check)
    await expectInTranscript(page, REPLY, `${check}: the session gets no reply.`)
    await expect(stopButton(page), `${check}: the turn does not end.`).toHaveCount(0)

    await expect(modelButton(page), `${check}: the session window has no model button "Model".`).toBeVisible()
    await expect(modelButton(page), `${check}: the model button must show the model of the session, "Opus 5.5".`).toHaveText('Opus 5.5')
    await expect(modelButton(page), `${check}: after the first message, the model button must be disabled.`).toBeDisabled()
  })

  test('S8-7: after the first message, sessions.set-model answers session-started, and the saved model stays', async ({ chat }) => {
    const check = 'S8-7, sessions.set-model'
    await chat.control.scenario('text', { chunks: ['Hello ', 'from the agent.'] })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    await chooseModel(page, 'Opus 5.5', check)
    await startSession(page, 'Say hello', check)
    await expectInTranscript(page, REPLY, `${check}: the session gets no reply.`)
    await expect(stopButton(page), `${check}: the turn does not end.`).toHaveCount(0)

    const { id } = await sessionNamed(page, 'Say hello', check)
    const answer = await answerOf(page, 'sessions.set-model', { id, model: MODEL_IDS['Haiku 5.5'] })
    expect(answer.ok, `${check}: sessions.set-model must refuse a session after its first message, but it answered ${JSON.stringify(answer)}.`).toBe(false)
    expect(
      answer.ok ? undefined : answer.error.code,
      `${check}: sessions.set-model must answer the error "session-started" after the first message, but it answered ${JSON.stringify(answer)}.`
    ).toBe('session-started')

    const opened = await invoke(page, 'sessions.open', { id })
    if (!opened.ok) throw new Error(`${check}: sessions.open failed: ${opened.error.message}`)
    expect((opened.value.session as { model: string }).model, `${check}: the refused change must keep the saved model.`).toBe(MODEL_IDS['Opus 5.5'])
  })
})
