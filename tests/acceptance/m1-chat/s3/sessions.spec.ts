// The session slices of story S3 of milestone m1-chat, on the built app.
//
// Plan, S3: create, list, open and delete sessions from the database. Draft sessions open with
// their prompt and their imported mode.
// Flow 6 of the brief: a draft session from the import opens with its prompt in the composer.
// Decision 0005: Aether never changes the old `workspace.json` or `runs/`.
//
// The agent does not run in S3. These tests do not check what a new session shows before story
// S4, and they do not press Send in a draft.
// No test sleeps. Each wait is an auto-waiting check of Playwright.
import {
  chooseMode,
  expect,
  expectMode,
  folderOf,
  holds,
  holdsPath,
  main,
  MODE_LABELS,
  modesOf,
  PROFILES,
  readFiles,
  sessionEntry,
  startImported,
  startSession,
  test,
  writeOldProfile,
  type Draft
} from './fixture'

const OLD_FILES = ['workspace.json', 'runs']

/** One draft of each mode that the import can give. */
const DRAFTS: Draft[] = [
  { prompt: 'Write the release notes', account: 'personal', mode: 'plan', createdAt: '2026-01-02T00:00:00.000Z' },
  { prompt: 'Fix the login page', account: 'personal', mode: 'auto', createdAt: '2026-01-04T00:00:00.000Z' },
  { prompt: 'Review the invoice export', account: 'personal', mode: 'approve-all', createdAt: '2026-01-01T00:00:00.000Z' },
  { prompt: 'Rename the old files', account: 'personal', mode: 'ask', createdAt: '2026-01-03T00:00:00.000Z' }
]

test.describe('S3: sessions are created, listed, opened and deleted from the database', () => {
  test('S3 create and list: Start session saves a new session, lists it in the sidebar, opens it, and lists it after a restart', async ({
    aether
  }) => {
    await writeOldProfile(aether, DRAFTS)
    const before = await readFiles(aether.dataDir, OLD_FILES)
    let page = await startImported(aether)

    // The composer starts with the folder of the last session, "Fix the login page".
    await chooseMode(page, 'plan', 'S3 create')
    await startSession(page, 'Say hello\nThen list the files.', 'S3 create')
    await expect(
      main(page).getByRole('heading', { name: 'Say hello', exact: true }),
      'S3 open: the window of the new session does not show its title.'
    ).toBeVisible()

    // The list comes from the database: a restart lists the new session and the drafts.
    await aether.stop()
    page = await aether.start()
    await expect(sessionEntry(page, 'Say hello'), 'S3 list: after a restart, the sidebar does not list the new session.').toBeVisible()
    for (const draft of DRAFTS) {
      await expect(sessionEntry(page, draft.prompt), `S3 list: after a restart, the sidebar does not list "${draft.prompt}".`).toBeVisible()
    }
    await aether.stop()

    const data = await aether.readDatabase()
    const dump = `The database holds:\n${data.describe()}`
    const rows = data.sessionsWithPrompt('Say hello\nThen list the files.')
    expect(rows, `S3 create: the database must hold one session with the prompt of the new session.\n${dump}`).toHaveLength(1)
    const row = rows[0]!
    expect(data.rowsOf(row.table), `S3 create: 5 sessions must exist, the 4 drafts and the new one.\n${dump}`).toHaveLength(5)
    expect(modesOf(row), 'S3 create: the new session must keep the mode that the user chose.').toEqual(['plan'])
    expect(holds(row, 'Say hello'), `S3 create: the new session must have the title "Say hello".\n${dump}`).toBe(true)
    expect(
      holdsPath(row, folderOf(aether, 'personal')),
      `S3 create: the new session must keep its folder ${folderOf(aether, 'personal')}.\n${dump}`
    ).toBe(true)
    const profiles = data.holding(PROFILES.personal)
    expect(profiles, `The database must hold one profile "${PROFILES.personal}".\n${dump}`).toHaveLength(1)
    expect(
      holds(row, String(profiles[0]!.values.id)),
      `S3 create: the new session must belong to the profile "${PROFILES.personal}".\n${dump}`
    ).toBe(true)

    expect(await readFiles(aether.dataDir, OLD_FILES), 'S3 create: the old files changed.').toEqual(before)
  })

  test('S3 open: a draft opens with its prompt in the composer and its imported mode', async ({ aether }) => {
    await writeOldProfile(aether, DRAFTS)
    const page = await startImported(aether)

    for (const draft of DRAFTS) {
      const entry = sessionEntry(page, draft.prompt)
      await expect(entry, `S3 list: the sidebar does not list the draft "${draft.prompt}".`).toBeVisible()
      await entry.click()
      await expect(entry, `S3 open: the draft "${draft.prompt}" does not open.`).toHaveAttribute('aria-current', 'page')

      const prompt = main(page).getByRole('textbox', { name: 'Prompt', exact: true })
      await expect(prompt, `S3 open: the draft "${draft.prompt}" has no composer with the text field "Prompt".`).toBeVisible()
      await expect(prompt, `S3 open: the composer of the draft does not hold its prompt "${draft.prompt}".`).toHaveValue(draft.prompt)
      await expectMode(
        page,
        draft.mode,
        `S3 open: the draft "${draft.prompt}" must show its imported mode ${MODE_LABELS[draft.mode]}.`
      )
    }
  })

  test('S3 delete: Delete session asks first, then removes the session from the sidebar and the database', async ({ aether }) => {
    await writeOldProfile(aether, DRAFTS)
    const before = await readFiles(aether.dataDir, OLD_FILES)
    const [deleted, kept] = [DRAFTS[0]!, DRAFTS[1]!]
    let page = await startImported(aether)

    await sessionEntry(page, deleted.prompt).click()
    await expect(sessionEntry(page, deleted.prompt)).toHaveAttribute('aria-current', 'page')
    // S10 (user decision, 2026-11-28): "Delete session" is an item of the menu "Session options" of the
    // title strip: "Delete" in a started session, "Discard draft" in a draft. It asks the same confirmation.
    const remove = async () => {
      const options = main(page).getByRole('button', { name: 'Session options', exact: true })
      await expect(options, 'S3 delete: the session window has no button "Session options".').toBeVisible()
      await options.click()
      const menu = page.getByRole('group', { name: 'Session options', exact: true }).or(page.getByRole('menu', { name: 'Session options', exact: true }))
      const item = menu.getByRole('button').or(menu.getByRole('menuitem')).filter({ hasText: /^\s*(Delete|Discard draft)/ })
      await expect(item, 'S3 delete: the menu "Session options" has no item "Delete" or "Discard draft".').toHaveCount(1)
      await expect(item, 'S3 delete: the item that deletes the session is disabled.').toBeEnabled()
      await item.click()
    }

    // Cancel keeps the session.
    await remove()
    let dialog = page.getByRole('dialog', { name: /^Delete/ })
    await expect(dialog, 'S3 delete: "Delete session" does not ask first.').toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(sessionEntry(page, deleted.prompt), 'S3 delete: Cancel deleted the session.').toBeVisible()

    // "Delete session" in the dialog deletes it.
    await remove()
    dialog = page.getByRole('dialog', { name: /^Delete/ })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Delete session', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(sessionEntry(page, deleted.prompt), 'S3 delete: the sidebar still lists the deleted session.').toHaveCount(0)
    await expect(
      main(page).getByRole('heading', { name: deleted.prompt, exact: true }),
      'S3 delete: the window still shows the deleted session.'
    ).toHaveCount(0)
    await expect(sessionEntry(page, kept.prompt), 'S3 delete: the sidebar lost another session.').toBeVisible()

    // The deletion is in the database: a restart does not list the session.
    await aether.stop()
    page = await aether.start()
    await expect(sessionEntry(page, kept.prompt)).toBeVisible()
    await expect(sessionEntry(page, deleted.prompt), 'S3 delete: after a restart, the sidebar lists the deleted session.').toHaveCount(0)
    await aether.stop()

    const data = await aether.readDatabase()
    const dump = `The database holds:\n${data.describe()}`
    expect(data.sessionsWithPrompt(deleted.prompt), `S3 delete: the database still holds the deleted session.\n${dump}`).toHaveLength(0)
    for (const draft of DRAFTS.slice(1)) {
      expect(data.sessionsWithPrompt(draft.prompt), `S3 delete: the database lost the session "${draft.prompt}".\n${dump}`).toHaveLength(1)
    }
    expect(await readFiles(aether.dataDir, OLD_FILES), 'S3 delete: the old files changed.').toEqual(before)
  })
})
