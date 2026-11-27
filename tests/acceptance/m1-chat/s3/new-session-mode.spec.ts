// A14 of milestone m1-chat, on the built app. It covers the defect "New session copies Approve
// all" of `docs/architecture.md`.
//
// A14: the last session used Approve all, or Auto. The user opens a new session. After Approve
// all, the mode shows Ask. After Auto, the mode shows Auto.
// Brief, approach: a new session copies the mode of the last session. Approve all is never
// copied. It becomes Ask.
//
// "The last session" is read as the most recently created session of the current profile.
// The order of the drafts in the old file differs from the order of their creation times, so
// only the creation time can pick the last session.
// No test sleeps. Each wait is an auto-waiting check of Playwright.
import {
  chooseMode,
  expect,
  expectMode,
  modesOf,
  openNewSession,
  PROFILES,
  startImported,
  startSession,
  switchProfile,
  test,
  writeOldProfile,
  type Draft
} from './fixture'

const day = (n: number) => `2026-01-0${n}T00:00:00.000Z`

test.describe('A14: a new session copies the mode of the last session, except Approve all', () => {
  test('A14: after a last session with Approve all, a new session shows Ask', async ({ aether }) => {
    // The last session used Approve all. The ones before it used Auto and Plan.
    await writeOldProfile(aether, [
      { prompt: 'Review the invoice export', account: 'personal', mode: 'approve-all', createdAt: day(3) },
      { prompt: 'Write the release notes', account: 'personal', mode: 'plan', createdAt: day(1) },
      { prompt: 'Fix the login page', account: 'personal', mode: 'auto', createdAt: day(2) }
    ])
    const page = await startImported(aether)

    await expectMode(page, 'ask', 'A14: after a last session with Approve all, the new session must show Ask.')
  })

  test('A14: after a last session with Auto, a new session shows Auto', async ({ aether }) => {
    await writeOldProfile(aether, [
      { prompt: 'Fix the login page', account: 'personal', mode: 'auto', createdAt: day(3) },
      { prompt: 'Review the invoice export', account: 'personal', mode: 'approve-all', createdAt: day(1) },
      { prompt: 'Write the release notes', account: 'personal', mode: 'plan', createdAt: day(2) }
    ])
    const page = await startImported(aether)

    await expectMode(page, 'auto', 'A14: after a last session with Auto, the new session must show Auto.')
  })

  test('A14: the last session is the last session of the current profile', async ({ aether }) => {
    // The last session of all is the one of "Client Example", with Approve all.
    const drafts: Draft[] = [
      { prompt: 'Review the invoice export', account: 'client', mode: 'approve-all', createdAt: day(3) },
      { prompt: 'Fix the login page', account: 'personal', mode: 'auto', createdAt: day(2) },
      { prompt: 'Write the release notes', account: 'personal', mode: 'plan', createdAt: day(1) }
    ]
    await writeOldProfile(aether, drafts)
    const page = await startImported(aether)

    await expectMode(page, 'auto', 'A14: the new session of "Personal" must copy Auto from the last session of "Personal".')

    await switchProfile(page, PROFILES.personal, PROFILES.client)
    await openNewSession(page)
    await expectMode(page, 'ask', 'A14: the new session of "Client Example" must show Ask after its last session with Approve all.')

    await switchProfile(page, PROFILES.client, PROFILES.personal)
    await openNewSession(page)
    await expectMode(page, 'auto', 'A14: the new session of "Personal" must still copy Auto from the last session of "Personal".')
  })

  test('A14: after the user creates a session with Auto, then one with Approve all, the next new session shows Auto, then Ask, also after a restart', async ({
    aether
  }) => {
    await writeOldProfile(aether, [{ prompt: 'Rename the old files', account: 'personal', mode: 'ask', createdAt: day(1) }])
    let page = await startImported(aether)
    await expectMode(page, 'ask', 'A14: after a last session with Ask, the new session must show Ask.')

    // A session with Auto. The next new session copies Auto.
    await chooseMode(page, 'auto', 'A14')
    await startSession(page, 'Fix the login page', 'A14')
    await openNewSession(page)
    await expectMode(page, 'auto', 'A14: after the user created a session with Auto, the new session must show Auto.')

    // A session with Approve all. The next new session shows Ask.
    await chooseMode(page, 'approve-all', 'A14')
    await startSession(page, 'Delete the temporary files', 'A14')
    await openNewSession(page)
    await expectMode(page, 'ask', 'A14: after the user created a session with Approve all, the new session must show Ask.')

    // The last session comes from the database, so a restart shows the same.
    await aether.stop()
    page = await aether.start()
    await expectMode(page, 'ask', 'A14: after a restart, the new session must show Ask after the last session with Approve all.')
    await aether.stop()

    // The two sessions keep the modes that the user chose.
    const data = await aether.readDatabase()
    for (const [prompt, mode] of [
      ['Fix the login page', 'auto'],
      ['Delete the temporary files', 'approve-all']
    ] as const) {
      const rows = data.sessionsWithPrompt(prompt)
      expect(rows, `A14: the database must hold one session "${prompt}".\n${data.describe()}`).toHaveLength(1)
      expect(modesOf(rows[0]!), `A14: the session "${prompt}" must keep the mode ${mode}.`).toEqual([mode])
    }
  })
})
