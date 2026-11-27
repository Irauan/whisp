// The plan defect "Aether sets no permission mode" of milestone m1-chat, which story S4 fixes, on
// the built app (coordinator request, 2026-11-27).
//
// Architecture, Permissions: Aether sets the permission mode before the first message.
// Decision 0012: the mode Ask gives the Claude permission mode `default`.
// One mode is enough here. Check A12 of story S7 covers all five.
// No test sleeps. Each wait is an auto-waiting check of Playwright, or a report of the agent.
import {
  DRAFT_IN_REPO_A,
  expect,
  expectInTranscript,
  sessionIdOf,
  startImported,
  startSession,
  test,
  writeOldProfile
} from './fixture'
import { expectMode } from '../s3/fixture'

test.describe('S4 defect "no permission mode": Aether sets the mode before the first message', () => {
  test('S4 permission mode: a session in mode Ask sends session/set_mode "default" on its agent session before the first prompt', async ({
    chat
  }) => {
    await chat.control.scenario('text', { chunks: ['Hello ', 'from the agent.'] })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    // The last session has Ask, so the new session has Ask.
    await expectMode(page, 'ask', 'S4 permission mode: the new session must show Ask.')
    await startSession(page, 'Say hello', 'S4 permission mode')
    await expectInTranscript(page, 'Hello from the agent.', 'S4 permission mode: the session gets no reply.')

    const { messages } = chat.control
    await expect.poll(() => chat.control.received('session/prompt').length, { message: 'S4 permission mode: the agent got no prompt.' }).toBe(1)
    const firstPrompt = messages.findIndex((message) => message.method === 'session/prompt')
    const setMode = messages.findIndex((message) => message.method === 'session/set_mode')
    expect(setMode, 'S4 permission mode: the agent got no session/set_mode.').toBeGreaterThanOrEqual(0)
    expect(setMode, 'S4 permission mode: session/set_mode must come before the first session/prompt.').toBeLessThan(firstPrompt)
    expect(messages[setMode]!.params, 'S4 permission mode: the mode Ask must reach the agent as "default".').toMatchObject({ modeId: 'default' })
    expect(sessionIdOf(messages[setMode]!), 'S4 permission mode: session/set_mode must name the agent session of the prompt.').toBe(
      sessionIdOf(messages[firstPrompt]!)
    )
  })
})
