// The notes of the S3 review for story S7 of milestone m1-chat, on the built app with the
// simulated agent: an unknown attachment kind, a `session` attachment, and an unknown model are
// refused at start.
// Brief, approach: the session attachment is disabled, "coming soon". Decision 0012, item 6, and
// architecture, Permissions: if the agent cannot apply the model, the session does not start.
// The composer offers only known kinds and models, so the tests send the session through the
// contracts of the bridge, as a renderer can. The fixture states what "refused" means.
// The unknown model has a wider rule (coordinator decision, 2026-11-27): Claude adds models over
// time, so the list of Aether can lag. The agent can refuse the model instead. The session then
// shows a start notice, and the agent gets no prompt.
// No test sleeps. Each wait is an auto-waiting check of Playwright, or a report of the agent.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import {
  DRAFT_IN_REPO_A,
  expect,
  folderPath,
  invoke,
  startImported,
  test,
  writeOldProfile,
  type ChatApp
} from './fixture'

interface Attempt {
  model: string
  attachments: { kind: string; ref: string; label: string }[]
}

/** Where Aether stopped the session: at create, at the first send, with an error notice, or not at all. */
type Outcome = 'create' | 'send' | 'notice' | 'agent process'

/** The profile "Personal", its draft and a file in the session folder `repo-a`. */
async function prepare(chat: ChatApp) {
  await writeOldProfile(chat, [DRAFT_IN_REPO_A])
  const page = await startImported(chat)
  const file = join(folderPath(chat, 'repo-a'), 'notes.txt')
  await writeFile(file, 'Fake notes for the test.\n')
  const profiles = await invoke(page, 'profiles.list', {})
  if (!profiles.ok) throw new Error(`profiles.list failed: ${profiles.error.message}`)
  const profileId = profiles.value.currentId as string
  const sessions = await invoke(page, 'sessions.list', { profileId })
  if (!sessions.ok) throw new Error(`sessions.list failed: ${sessions.error.message}`)
  const draft = (sessions.value.sessions as { id: string; title: string }[])[0]!
  return { page, file, profileId, draft }
}

/** True when the session shows an error notice. */
async function hasErrorNotice(page: Page, id: string): Promise<boolean> {
  const opened = await invoke(page, 'sessions.open', { id })
  const entries = opened.ok ? (opened.value.entries as { entry: { kind: string; tone?: string } }[]) : []
  return entries.some(({ entry }) => entry.kind === 'notice' && entry.tone === 'error')
}

/**
 * Creates a session through `sessions.create`, sends its first message, and tells where Aether
 * stopped it. `id` is the session, when `sessions.create` made one.
 */
async function attempt(
  chat: ChatApp,
  page: Page,
  profileId: string,
  { model, attachments }: Attempt,
  check: string
): Promise<{ outcome: Outcome; id?: string }> {
  const created = await invoke(page, 'sessions.create', {
    profileId,
    prompt: 'Say hello',
    mode: 'ask',
    model,
    sourcePath: folderPath(chat, 'repo-a'),
    attachments
  })
  if (!created.ok) return { outcome: 'create' }
  const id = created.value.id as string
  const sent = await invoke(page, 'sessions.send-message', { id, text: 'Say hello' })
  if (!sent.ok) return { outcome: 'send', id }
  // The start runs after the send. Wait until an agent process connects, or the session shows an error notice.
  let outcome: Outcome | 'pending' = 'pending'
  await expect
    .poll(
      async () => {
        if (chat.control.pids.length > 0) outcome = 'agent process'
        else if (await hasErrorNotice(page, id)) outcome = 'notice'
        return outcome
      },
      { message: `${check}: the session neither started an agent process nor showed an error notice.` }
    )
    .not.toBe('pending')
  return { outcome: outcome as Outcome, id }
}

/** Checks that Aether refused the session before any agent process started. */
function expectRefused(chat: ChatApp, outcome: Outcome, check: string): void {
  expect(outcome, `${check}: Aether started an agent process for the session. It must refuse the session at start.`).not.toBe('agent process')
  expect(chat.control.pids, `${check}: an agent process started, so Aether did not refuse the session before the start.`).toEqual([])
}

/**
 * Checks the refusal of an unknown model. Aether refuses it before the start, as `expectRefused`
 * checks. Or the agent refuses it: the session then shows a start notice, and the agent gets no prompt.
 */
async function expectModelRefused(chat: ChatApp, page: Page, { outcome, id }: { outcome: Outcome; id?: string }, check: string): Promise<void> {
  if (outcome !== 'agent process') {
    expectRefused(chat, outcome, check)
    return
  }
  await expect
    .poll(() => hasErrorNotice(page, id!), { message: `${check}: the agent process started, and the session shows no start notice that refuses the model.` })
    .toBe(true)
  expect(chat.control.received('session/prompt'), `${check}: the agent got a prompt, so the session started with a model that Aether does not know.`).toEqual([])
}

test.describe('S3 review notes for S7: settings that Aether does not know are refused at start', () => {
  test('S3 review precondition: a known model and a file attachment start an agent process through the same contracts', async ({ chat }) => {
    const check = 'S3 review precondition'
    await chat.control.scenario('text', { chunks: ['Hello'] })
    const { page, file, profileId } = await prepare(chat)
    const { outcome } = await attempt(chat, page, profileId, { model: 'claude-opus-5-5', attachments: [{ kind: 'file', ref: file, label: 'notes.txt' }] }, check)
    expect(outcome, `${check}: a valid session must start an agent process, or the refusal tests prove nothing.`).toBe('agent process')
  })

  test('S3 review: an attachment of an unknown kind is refused at start, and no agent process starts', async ({ chat }) => {
    const check = 'S3 review unknown attachment kind'
    await chat.control.scenario('text', { chunks: ['Hello'] })
    const { page, file, profileId } = await prepare(chat)
    const { outcome } = await attempt(chat, page, profileId, { model: 'default', attachments: [{ kind: 'snippet', ref: file, label: 'notes.txt' }] }, check)
    expectRefused(chat, outcome, check)
  })

  test('S3 review: a session attachment is refused at start, and no agent process starts', async ({ chat }) => {
    const check = 'S3 review session attachment'
    await chat.control.scenario('text', { chunks: ['Hello'] })
    const { page, profileId, draft } = await prepare(chat)
    const { outcome } = await attempt(chat, page, profileId, { model: 'default', attachments: [{ kind: 'session', ref: draft.id, label: draft.title }] }, check)
    expectRefused(chat, outcome, check)
  })

  test('S3 review: a model that Aether does not know is refused at start: no prompt reaches the agent, and the session shows a start notice', async ({
    chat
  }) => {
    const check = 'S3 review unknown model'
    await chat.control.scenario('text', { chunks: ['Hello'] })
    const { page, profileId } = await prepare(chat)
    const attempted = await attempt(chat, page, profileId, { model: 'claude-unknown-9-9', attachments: [] }, check)
    await expectModelRefused(chat, page, attempted, check)
  })
})
