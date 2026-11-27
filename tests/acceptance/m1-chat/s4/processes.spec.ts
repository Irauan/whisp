// A7 of milestone m1-chat, on the built app. It covers the defect "Two sessions that start at the
// same time share a process before it is ready. The second fails." of `docs/architecture.md`.
//
// A7: two sessions in two folders. The user sends in both within 100 ms. Both get replies. Each
// session has its own process.
//
// Reading of "within 100 ms": the defect needs the second send to arrive before the first process
// is ready. A wall clock through clicks would make the test flaky. So the agent holds its answer to
// `initialize` at a gate, and the test sends in the second session while the first process waits
// there. Each send then happens before any process is ready, which is the case of the defect.
// The two sessions are drafts of the import in R/repo-a and R/repo-b. Send starts each (flow 6).
// No test sleeps. Each wait is an auto-waiting check of Playwright, or a report of the agent.
import {
  cwdOf,
  expect,
  expectInTranscript,
  folderPath,
  ofProcess,
  promptField,
  reach,
  samePath,
  sendButton,
  sessionEntry,
  starting,
  startImported,
  test,
  writeOldProfile,
  type Draft
} from './fixture'
import type { Page } from '@playwright/test'

const DRAFTS: Draft[] = [
  { prompt: 'Fix the login page', folder: 'repo-a', createdAt: '2026-01-01T00:00:00.000Z' },
  { prompt: 'Write the release notes', folder: 'repo-b', createdAt: '2026-01-02T00:00:00.000Z' }
]

/** Opens a draft from the sidebar and clicks "Send", which starts it with its prompt. */
async function sendDraft(page: Page, draft: Draft): Promise<void> {
  const entry = sessionEntry(page, draft.prompt)
  await expect(entry, `A7: the sidebar does not list the draft "${draft.prompt}".`).toBeVisible()
  await entry.click()
  await expect(entry).toHaveAttribute('aria-current', 'page')
  await expect(promptField(page), `A7: the draft "${draft.prompt}" does not hold its prompt.`).toHaveValue(draft.prompt)
  await expect(sendButton(page), `A7 (flow 6): "Send" is not enabled in the draft "${draft.prompt}".`).toBeEnabled()
  await sendButton(page).click()
}

test.describe('A7: two sessions that start at the same time each get their own process', () => {
  test('A7: two sessions in two folders that send before any process is ready both get replies, each from its own process', async ({
    chat
  }) => {
    await chat.control.scenario('slow-start', { gate: 'initialize', chunks: ['Hello ', 'from the agent.'] })
    await writeOldProfile(chat, DRAFTS)
    const page = await startImported(chat)

    const [first, second] = DRAFTS as [Draft, Draft]
    await sendDraft(page, first)
    await expect(starting(page), 'A7: the first session does not show "Starting Claude Code" while its agent starts.').toBeVisible()
    await reach(chat.control.waitForGate('initialize'), 'A7: the first session started no agent process.')

    // The first process is not ready. The second session sends now.
    await sendDraft(page, second)
    await reach(
      chat.control.waitForGate('initialize'),
      'A7: the second session started no agent process of its own while the first process was not ready.'
    )
    await chat.control.open('initialize')

    // Both get replies.
    await expectInTranscript(page, 'Hello from the agent.', `A7: the session "${second.prompt}" gets no reply.`)
    await sessionEntry(page, first.prompt).click()
    await expect(sessionEntry(page, first.prompt)).toHaveAttribute('aria-current', 'page')
    await expectInTranscript(page, 'Hello from the agent.', `A7: the session "${first.prompt}" gets no reply.`)

    // Each session has its own process: one agent session and one prompt in each process.
    const { control } = chat
    await expect.poll(() => control.received('session/prompt').length, { message: 'A7: the agents must get two prompts.' }).toBe(2)
    const pids = [...new Set(control.pids)]
    expect(pids, 'A7: two agent processes must start, one for each session.').toHaveLength(2)
    for (const [index, draft] of DRAFTS.entries()) {
      const folder = folderPath(chat, draft.folder)
      const owners = pids.filter((pid) =>
        ofProcess(control.receivedBy('session/new'), pid).some(({ message }) => samePath(cwdOf(message), folder))
      )
      expect(owners, `A7: exactly one process must hold the agent session in ${folder} (session ${index + 1}).`).toHaveLength(1)
    }
    for (const pid of pids) {
      expect(ofProcess(control.receivedBy('session/new'), pid), 'A7: each process must hold one agent session.').toHaveLength(1)
      expect(ofProcess(control.receivedBy('session/prompt'), pid), 'A7: each process must get one prompt.').toHaveLength(1)
    }
  })
})
