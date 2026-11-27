// The fixture of the S9 tests of milestone m1-chat on the built app: A22 (the idle limit) and S9-4
// (no process of the agent tree runs after a release). Spec:
// `docs/milestones/m1-chat/stories/s9-idle-release.md`.
//
// It reuses the chat fixture of S4 (`../s4/fixture.ts`): the built app in a temporary data folder,
// a temporary APPDATA and home, the fake `gh`, the simulated agent as Claude Code in `agents.json`,
// and the check that the real data folder (`%APPDATA%\aether`) does not change. All data is fake.
// The product has no test hook.
//
// The data. The old `workspace.json` holds the profile "Personal" and the drafts of a test, in the
// plain folders `repo-a` and `repo-b` of its workspace directory, so Aether asks no trust question
// (S6). Send in a draft starts it with its prompt (flow 6).
//
// No clock. The rule of the idle limit runs at each turn end (spec, "When the rule runs"), so the
// seventh turn end triggers it. The release time of 30 minutes never passes in these tests.
//
// Agent processes. Each session has its own agent process (A7). The tests find the process of a
// session by its first prompt: the prompt of the draft. A process that runs answers signal 0.
//
// Cleanup. The simulated agent of the scenario `child-process` starts a child that outlives it,
// so the fixture kills each reported child, stops the app, then kills each process whose command
// line names the control pipe of the test. No process of a test outlives it.
//
// No test sleeps. A test waits on an auto-waiting check of Playwright, on a report of the
// simulated agent through `reach`, or on `expect.poll` with a message.
import { spawnSync } from 'node:child_process'
import type { Page } from '@playwright/test'
import {
  expect,
  expectInTranscript,
  expectReady,
  promptField,
  sendButton,
  sessionEntry,
  test as chatTest,
  writeOldProfile,
  type ChatApp,
  type Draft
} from '../s4/fixture'

export { expect, type ChatApp, type Draft }
export { expectInTranscript, expectReady, reach, send, sessionEntry, startImported, working } from '../s4/fixture'

/** Whether a process runs. Signal 0 only checks it. */
export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** The IDs of the running processes whose command line names the control pipe of the test. Windows lists them through CIM. */
function processesOfTest(chat: ChatApp): number[] {
  const id = chat.control.pipeName.slice(-36) // The UUID at the end of the pipe name.
  const script = `Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%${id}%'" | Where-Object { $_.ProcessId -ne $PID } | ForEach-Object { $_.ProcessId }`
  const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true })
  if (run.error || run.status !== 0) return []
  return run.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(Number)
}

/** Ends a process when it runs. */
function end(pid: number): void {
  try {
    if (isRunning(pid)) process.kill(pid)
  } catch {
    // It ended in the meantime.
  }
}

/** The S4 app fixture. At the end it kills each child of the agent and each process of the test that still runs. */
export const test = chatTest.extend<{ chat: ChatApp }>({
  chat: async ({ chat }, use) => {
    try {
      await use(chat)
    } finally {
      // A child that still runs holds handles that it inherited from the app, so the app cannot
      // close before the child ends. Kill the children first.
      for (const { pid } of chat.control.children) end(pid)
      await chat.stop()
      for (const pid of processesOfTest(chat)) end(pid)
    }
  }
})

/** The reply of the simulated agent in these tests. */
export const REPLY = 'Hello from the agent.'
export const REPLY_CHUNKS = ['Hello ', 'from the agent.']

/** The creation time of day `n` of January 2026. The order of the days is the order of the drafts. */
const day = (n: number) => `2026-01-${String(n).padStart(2, '0')}T00:00:00.000Z`

/** Writes the old file with one draft for each prompt, in `repo-a` and `repo-b` in turn. */
export async function writeDrafts(chat: ChatApp, prompts: readonly string[]): Promise<void> {
  const drafts: Draft[] = prompts.map((prompt, index) => ({ prompt, folder: index % 2 === 0 ? 'repo-a' : 'repo-b', createdAt: day(index + 1) }))
  await writeOldProfile(chat, drafts)
}

/** Opens a draft from the sidebar and clicks "Send", which starts it with its prompt (flow 6). */
export async function sendDraft(page: Page, prompt: string, check: string): Promise<void> {
  const entry = sessionEntry(page, prompt)
  await expect(entry, `${check}: the sidebar does not list the draft "${prompt}".`).toBeVisible()
  await entry.click()
  await expect(entry, `${check}: the draft "${prompt}" does not open.`).toHaveAttribute('aria-current', 'page')
  await expect(promptField(page), `${check}: the draft "${prompt}" does not hold its prompt.`).toHaveValue(prompt)
  await expect(sendButton(page), `${check} (flow 6): "Send" is not enabled in the draft "${prompt}".`).toBeEnabled()
  await sendButton(page).click()
}

/** Starts a draft and waits until its turn ended: the reply shows and the composer is ready. Its process is then idle. */
export async function runDraft(page: Page, prompt: string, check: string): Promise<void> {
  await sendDraft(page, prompt, check)
  await expectInTranscript(page, REPLY, `${check}: the session "${prompt}" gets no reply.`)
  await expectReady(page, `${check} (session "${prompt}")`)
}

/** Opens a session from the sidebar. */
export async function openSession(page: Page, prompt: string, check: string): Promise<void> {
  const entry = sessionEntry(page, prompt)
  await expect(entry, `${check}: the sidebar does not list the session "${prompt}".`).toBeVisible()
  await entry.click()
  await expect(entry, `${check}: the session "${prompt}" does not open.`).toHaveAttribute('aria-current', 'page')
}

/** The process ID of the agent of a session: the process that got the first prompt of the session. */
export function processOf(chat: ChatApp, prompt: string, check: string): number {
  const found = chat.control.receivedBy('session/prompt').find(({ message }) => {
    const blocks = (message.params as { prompt?: { type?: string; text?: string }[] } | undefined)?.prompt ?? []
    return blocks[0]?.type === 'text' && blocks[0].text === prompt
  })
  if (!found) throw new Error(`${check}: no agent process got the prompt "${prompt}".`)
  return found.pid
}

/** Checks that the process of each session runs. */
export function expectRunning(chat: ChatApp, prompts: readonly string[], message: (prompt: string) => string): void {
  for (const prompt of prompts) {
    const pid = processOf(chat, prompt, message(prompt))
    expect(isRunning(pid), `${message(prompt)} (process ${pid})`).toBe(true)
  }
}

/** Waits until the process of a session ends. */
export async function expectEnds(chat: ChatApp, prompt: string, message: string): Promise<void> {
  const pid = processOf(chat, prompt, message)
  await expect.poll(() => isRunning(pid), { message: `${message} (process ${pid})` }).toBe(false)
}
