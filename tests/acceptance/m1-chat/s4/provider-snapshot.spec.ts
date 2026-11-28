// The provider snapshot of decision 0013, on the built app (coordinator request, 2026-11-27).
//
// Decision 0013: at the first start of a session, Aether saves a snapshot of the provider settings
// (migration 002). A resume of the session uses the snapshot, not the current row. A change of the
// provider settings applies to new sessions only. Claude keeps its session history in the config
// folder, so a session must resume with the folder that it started with.
//
// The Claude folders F1 and F2 are fake folders in the temporary folder of the test.
// No test sleeps. Each wait is an auto-waiting check of Playwright, or a report of the agent.
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DRAFT_IN_REPO_A,
  expect,
  expectInTranscript,
  expectReady,
  openNewSession,
  samePath,
  send,
  sessionEntry,
  setClaudeFolder,
  startImported,
  startSession,
  test,
  variable,
  writeOldProfile,
  type ChatApp
} from './fixture'

/** Waits for the start report of agent process number `count`, and returns its CLAUDE_CONFIG_DIR. */
async function claudeFolderOfProcess(chat: ChatApp, count: number, message: string): Promise<string | undefined> {
  await expect.poll(() => chat.control.environments.length, { message }).toBeGreaterThanOrEqual(count)
  return variable(chat.control.environments[count - 1]!.env, 'CLAUDE_CONFIG_DIR')
}

/** A label for a CLAUDE_CONFIG_DIR, so that a failure message says which folder the agent got. */
const labelOf = (value: string | undefined, folders: Record<string, string>) =>
  value === undefined ? 'no CLAUDE_CONFIG_DIR' : (Object.keys(folders).find((name) => samePath(value, folders[name]!)) ?? 'another folder')

test.describe('Decision 0013: a session resumes with the provider settings of its first start', () => {
  test('Decision 0013 provider snapshot: after a change of the Claude folder from F1 to F2 and a restart, the old session resumes with F1 and a new session starts with F2', async ({
    chat
  }) => {
    const folders = { F1: join(chat.root, 'claude', 'f1'), F2: join(chat.root, 'claude', 'f2') }
    for (const folder of Object.values(folders)) await mkdir(folder, { recursive: true })
    await chat.control.scenario('text', { chunks: ['Hello ', 'from the agent.'] })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    let page = await startImported(chat)

    // The session starts while the Claude folder of the profile is F1.
    await setClaudeFolder(page, folders.F1, 'Decision 0013')
    await startSession(page, 'Say hello', 'Decision 0013')
    await expectInTranscript(page, 'Hello from the agent.', 'Decision 0013: the first session gets no reply.')
    await expectReady(page, 'Decision 0013')
    const first = await claudeFolderOfProcess(chat, 1, 'Decision 0013: the first session started no agent process.')
    expect(labelOf(first, folders), 'Decision 0013: the first session must start with the Claude folder F1 of the profile.').toBe('F1')

    // The profile changes to F2. Aether restarts, so the old session needs a new process.
    await setClaudeFolder(page, folders.F2, 'Decision 0013')
    await chat.stop()
    page = await chat.start()
    const entry = sessionEntry(page, 'Say hello')
    await expect(entry, 'Decision 0013: after a restart, the sidebar does not list the session "Say hello".').toBeVisible()
    await entry.click()
    await expect(entry).toHaveAttribute('aria-current', 'page')
    await chat.control.scenario('text', { chunks: ['Welcome ', 'back.'] })
    await send(page, 'Are you still there?', 'Decision 0013')
    await expectInTranscript(page, 'Welcome back.', 'Decision 0013: the old session gets no reply after the restart.')
    await expectReady(page, 'Decision 0013')
    const resumed = await claudeFolderOfProcess(chat, 2, 'Decision 0013: the old session started no new agent process after the restart.')
    expect(
      labelOf(resumed, folders),
      'Decision 0013: the old session must resume with the Claude folder F1 of its first start, not the current F2.'
    ).toBe('F1')

    // A new session starts with the current Claude folder F2.
    await chat.control.scenario('text', { chunks: ['Hello ', 'from a new session.'] })
    await openNewSession(page)
    await startSession(page, 'Start fresh', 'Decision 0013')
    await expectInTranscript(page, 'Hello from a new session.', 'Decision 0013: the new session gets no reply.')
    const fresh = await claudeFolderOfProcess(chat, 3, 'Decision 0013: the new session started no agent process.')
    expect(labelOf(fresh, folders), 'Decision 0013: a new session must start with the current Claude folder F2.').toBe('F2')
  })
})
