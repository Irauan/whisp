// S11 of milestone m1-chat, on the built app: the renderer tells the main process the viewed session.
// Spec: `docs/milestones/m1-chat/stories/s11-sidebar-status.md`, check S11-21, and "The unread
// mark", "The viewed session".
//
// Level. The Checks table gives S11-21 the level "Unit". The renderer has no DOM test library
// (`package.json`), and the check is about what `App.tsx` sends on each change of the view. So this
// test checks it on the built app: `recordCalls` records each call of `sessions.set-viewing` in the
// main process, at the channel `aether:invoke`, as `holdAnswers` of S5 does. It is a change of the
// test to Electron, not a hook of the product.
//
// "Start" is the start of the renderer. The recorder can only start after the window loaded, so the
// test reloads the page: the spec sends `set-viewing` "at its start (also after a reload of the page)".
import type { Page } from '@playwright/test'
import {
  day,
  deleteOpenSession,
  expect,
  openSession,
  recordCalls,
  recordedCalls,
  sessionIds,
  sidebar,
  startImported,
  test,
  writeOldProfile,
  type ChatApp
} from './fixture'

const A = 'Fix the login page'
const B = 'Sort the notes'

/** Does the action, then checks that a new call of `sessions.set-viewing` came, and that the last one has this session ID. */
async function expectSent(chat: ChatApp, action: () => Promise<void>, sessionId: string | null, when: string): Promise<void> {
  const before = (await recordedCalls(chat)).length
  await action()
  await expect
    .poll(
      async () => {
        const calls = await recordedCalls(chat)
        return calls.length > before ? calls.at(-1) : 'no new call'
      },
      { message: `S11-21: ${when}, the renderer must send sessions.set-viewing { sessionId: ${JSON.stringify(sessionId)} }.` }
    )
    .toEqual({ sessionId })
}

const toolbarButton = (page: Page, name: 'Back' | 'Forward') => page.getByRole('button', { name, exact: true })

test.describe('S11-21: the renderer sends sessions.set-viewing at each change of the view', () => {
  test('S11-21: set-viewing is sent at the start, at a click, at Back, at Forward, and at a delete that goes to the New page, each time with the right ID', async ({
    chat
  }) => {
    await writeOldProfile(chat, [
      { prompt: B, folder: 'repo-a', createdAt: day(1) },
      { prompt: A, folder: 'repo-a', createdAt: day(2) }
    ])
    const page = await startImported(chat)
    const ids = await sessionIds(page)
    const idA = ids[A]
    const idB = ids[B]
    if (!idA || !idB) throw new Error(`S11-21: sessions.list does not list both drafts: ${JSON.stringify(ids)}`)
    await recordCalls(chat, 'sessions.set-viewing')

    // Start: the renderer starts on the New page, so no session is viewed.
    await expectSent(
      chat,
      async () => {
        await page.reload()
        await expect(sidebar(page), 'S11-21: the window does not load again after the reload.').toBeVisible()
      },
      null,
      'at the start of the renderer (after a reload)'
    )
    await expectSent(chat, () => openSession(page, A, 'S11-21'), idA, `at a click on "${A}"`)
    await expectSent(chat, () => openSession(page, B, 'S11-21'), idB, `at a click on "${B}"`)
    await expectSent(chat, () => toolbarButton(page, 'Back').click(), idA, 'at Back')
    await expectSent(chat, () => toolbarButton(page, 'Forward').click(), idB, 'at Forward')
    await expectSent(chat, () => deleteOpenSession(page, 'S11-21'), null, `at the delete of "${B}", which goes to the New page`)
  })
})
