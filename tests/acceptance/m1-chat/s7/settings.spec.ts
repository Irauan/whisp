// A12 of milestone m1-chat, on the built app with the simulated agent.
//
// A12: model Opus 5.5 and mode Ask. The session starts. The agent receives model `claude-opus-5-5`
// and mode `default`. Accept edits gives `acceptEdits`, Plan gives `plan`, Auto gives `auto`, and
// Approve all gives `bypassPermissions`. With a model that cannot use Auto, the notice shows.
// Brief, approach: the model is the `model` configuration option, and "Default" sends nothing.
// Mode Auto: if the model cannot use it, Claude uses `acceptEdits` and Aether shows the notice.
// Decision 0012, item 6: Aether sets the permission mode before the first message.
//
// The simulated agent of the scenario `no-auto` plays a model that cannot use Auto: it uses
// `acceptEdits` and reports a `current_mode_update`, as the Claude Code adapter does.
// No test sleeps. Each wait is an auto-waiting check of Playwright, or a report of the agent.
import {
  chooseMode,
  DRAFT_IN_REPO_A,
  expect,
  expectInTranscript,
  expectMode,
  FALLBACK_NOTICE,
  MODE_LABELS,
  sessionIdOf,
  settingsBeforeFirstPrompt,
  startImported,
  startSession,
  test,
  transcript,
  writeOldProfile,
  chooseModel,
  MODEL_IDS,
  type ChatApp,
  type ModelLabel
} from './fixture'
import type { Mode } from '../s2/fixture'

const REPLY = 'Hello from the agent.'

/** Starts a session in `repo-a` with the model and the mode, and waits for the reply to the first message. */
async function startWith(chat: ChatApp, model: ModelLabel, mode: Mode, check: string) {
  await writeOldProfile(chat, [DRAFT_IN_REPO_A])
  const page = await startImported(chat)
  // The last session has Ask, so the new session starts with Ask.
  await expectMode(page, 'ask', `${check}: the new session must start with Ask.`)
  if (model !== 'Default') await chooseModel(page, model, check)
  if (mode !== 'ask') await chooseMode(page, mode, check)
  await startSession(page, 'Say hello', check)
  await expectInTranscript(page, REPLY, `${check}: the session gets no reply.`)
  await expect.poll(() => chat.control.received('session/prompt').length, { message: `${check}: the agent got no prompt.` }).toBe(1)
  return page
}

/** Checks that the last mode before the first prompt is `claudeMode`, on the agent session of the prompt. */
function expectModeBeforePrompt(chat: ChatApp, claudeMode: string, check: string): void {
  const sent = settingsBeforeFirstPrompt(chat)
  expect(sent.modes, `${check}: the agent got no session/set_mode before the first message.`).not.toEqual([])
  expect(sent.modes.at(-1), `${check}: the mode must reach the agent as "${claudeMode}" before the first message.`).toBe(claudeMode)
  expect(sessionIdOf(sent.setModes.at(-1)!), `${check}: session/set_mode must name the agent session of the first prompt.`).toBe(
    sessionIdOf(sent.firstPrompt!)
  )
}

test.describe('A12: the model and the mode of a session reach the agent', () => {
  test('A12: model Opus 5.5 and mode Ask give the model claude-opus-5-5 and the mode default before the first message', async ({ chat }) => {
    const check = 'A12 Opus 5.5 and Ask'
    await chat.control.scenario('text', { chunks: ['Hello ', 'from the agent.'] })
    await startWith(chat, 'Opus 5.5', 'ask', check)

    expectModeBeforePrompt(chat, 'default', check)
    const sent = settingsBeforeFirstPrompt(chat)
    expect(sent.models, `${check}: the model must reach the agent as the configuration option "model" before the first message.`).toEqual([
      MODEL_IDS['Opus 5.5']
    ])
    expect(sessionIdOf(sent.setModels[0]!), `${check}: the model must be set on the agent session of the first prompt.`).toBe(
      sessionIdOf(sent.firstPrompt!)
    )
  })

  const MODES: [Mode, string][] = [
    ['accept-edits', 'acceptEdits'],
    ['plan', 'plan'],
    ['auto', 'auto'],
    ['approve-all', 'bypassPermissions']
  ]
  for (const [mode, claudeMode] of MODES) {
    test(`A12: mode ${MODE_LABELS[mode]} gives the permission mode ${claudeMode} before the first message`, async ({ chat }) => {
      const check = `A12 ${MODE_LABELS[mode]}`
      // Haiku 5.5 cannot use Auto in this scenario. The session uses Opus 5.5, so Auto stays.
      await chat.control.scenario('no-auto', { models: [MODEL_IDS['Haiku 5.5']], chunks: ['Hello ', 'from the agent.'] })
      const page = await startWith(chat, 'Opus 5.5', mode, check)

      expectModeBeforePrompt(chat, claudeMode, check)
      expect(settingsBeforeFirstPrompt(chat).models, `${check}: the model must reach the agent with the mode.`).toEqual([MODEL_IDS['Opus 5.5']])
      // A model that can use Auto shows no fallback notice.
      await expect(transcript(page).getByText(FALLBACK_NOTICE), `${check}: the transcript shows the Auto fallback notice for a model that can use Auto.`).toHaveCount(0)
    })
  }

  test('A12: the model Default sends no model to the agent', async ({ chat }) => {
    const check = 'A12 Default'
    await chat.control.scenario('text', { chunks: ['Hello ', 'from the agent.'] })
    await startWith(chat, 'Default', 'ask', check)

    expectModeBeforePrompt(chat, 'default', check)
    expect(settingsBeforeFirstPrompt(chat).allModels, `${check}: "Default" must send no configuration option "model".`).toEqual([])
  })

  test('A12: Auto with a model that cannot use it shows the notice that Claude uses Accept edits', async ({ chat }) => {
    const check = 'A12 Auto fallback'
    await chat.control.scenario('no-auto', { models: [MODEL_IDS['Haiku 5.5']], chunks: ['Hello ', 'from the agent.'] })
    const page = await startWith(chat, 'Haiku 5.5', 'auto', check)

    // Aether asked for auto with the model Haiku 5.5. The agent then used acceptEdits and said so.
    expectModeBeforePrompt(chat, 'auto', check)
    expect(settingsBeforeFirstPrompt(chat).models, `${check}: the model Haiku 5.5 must reach the agent.`).toEqual([MODEL_IDS['Haiku 5.5']])
    await expect(
      transcript(page).getByText(FALLBACK_NOTICE).first(),
      `${check}: the transcript shows no notice that names Auto and then Accept edits, after the agent fell back to acceptEdits.`
    ).toBeVisible()
  })
})
