// A10 of milestone m1-chat, on the built app: the directory questions.
//
// A10: a session folder outside the workspace directory, or under the workspace directory of
// another profile. The user sends the first message. The directory question shows, as
// `docs/architecture.md` describes:
// - Directory outside the workspace directory: Aether asks: once, always for this profile, or cancel.
// - Directory under the workspace directory of another profile: Aether asks, and names both
//   profiles and the Claude settings that would read the files.
// - No agent process starts before the answer.
// Decision 0013: a folder outside the workspace directory still gets the directory question.
// Review notes of S3 for S6: resolve `..`, junctions and letter case before the comparison.
//
// The fixture describes the UI contract and the readings of S6.
// No test sleeps. Each wait is an auto-waiting check of Playwright.
import { join } from 'node:path'
import {
  button,
  createFolder,
  createJunction,
  createRepository,
  day,
  directoryOf,
  expect,
  expectNoAgentProcess,
  expectNoQuestion,
  expectReply,
  main,
  openNewSession,
  otherProfileQuestion,
  outside,
  outsideQuestion,
  PROFILES,
  replyWithHello,
  sendDraft,
  setClaudeFolder,
  startSession,
  startWithoutDirectories,
  startWithProfiles,
  switchProfile,
  test,
  trustQuestion,
  writeProfiles,
  type ChatApp
} from './fixture'
import type { Page } from '@playwright/test'

/** Checks the question for a folder outside the workspace directory, while no agent process exists. */
async function expectOutsideQuestion(page: Page, chat: ChatApp, check: string, folder: string): Promise<void> {
  const question = outsideQuestion(page)
  await expect(question, `${check}: the first message in ${folder} shows no dialog "Use a folder outside the workspace directory?".`).toBeVisible()
  for (const name of ['Allow once', 'Always allow for this profile', 'Cancel']) {
    await expect(button(question, name), `${check}: the directory question has no button "${name}".`).toBeVisible()
  }
  await expect(trustQuestion(page), `${check}: the trust question shows for a folder outside the workspace directory.`).toHaveCount(0)
  expectNoAgentProcess(chat, check, 'while the directory question shows')
}

/** Cancels the question for a folder outside the workspace directory, and checks that no agent process exists. */
async function cancelOutsideQuestion(page: Page, chat: ChatApp, check: string): Promise<void> {
  await button(outsideQuestion(page), 'Cancel').click()
  await expect(outsideQuestion(page), `${check}: the directory question stays open after "Cancel".`).toBeHidden()
  expectNoAgentProcess(chat, check, 'after Cancel of the directory question')
}

test.describe('A10: the directory questions', () => {
  test('A10 outside and Cancel: a folder outside the workspace directory asks once, always for this profile, or cancel; no agent process exists before the answer or after Cancel', async ({
    chat
  }) => {
    await replyWithHello(chat)
    const folder = await createFolder(outside(chat, 'notes'))
    await writeProfiles(chat, [{ prompt: 'Sort the notes', profile: 'personal', folder, createdAt: day(1) }])
    const page = await startWithProfiles(chat)
    await sendDraft(page, 'Sort the notes', 'A10 outside')
    await expectOutsideQuestion(page, chat, 'A10 outside', folder)
    await cancelOutsideQuestion(page, chat, 'A10 outside')
    await chat.stop()
    expectNoAgentProcess(chat, 'A10 outside', 'after Cancel and the exit of Aether')
  })

  test('A10 once: "Allow once" starts the session, and a new session in the same folder asks again', async ({ chat }) => {
    await replyWithHello(chat)
    const folder = await createFolder(outside(chat, 'notes'))
    await writeProfiles(chat, [{ prompt: 'Sort the notes', profile: 'personal', folder, createdAt: day(1) }])
    const page = await startWithProfiles(chat)
    await sendDraft(page, 'Sort the notes', 'A10 once')
    await expectOutsideQuestion(page, chat, 'A10 once', folder)
    await button(outsideQuestion(page), 'Allow once').click()
    await expect(outsideQuestion(page), 'A10 once: the directory question stays open after "Allow once".').toBeHidden()
    await expectReply(page, 'A10 once: after "Allow once"')

    // The composer of the new session starts with the same folder. The question can come before
    // the session shows in the sidebar, so the test only writes the prompt and clicks.
    await openNewSession(page)
    await main(page).getByRole('textbox', { name: 'Prompt', exact: true }).fill('Archive the old notes')
    await main(page).getByRole('button', { name: 'Start session', exact: true }).click()
    await expect(outsideQuestion(page), 'A10 once: a new session in the same folder asks nothing after "Allow once", so the answer counted for more than once.').toBeVisible()
    expect(new Set(chat.control.pids).size, 'A10 once: an agent process started for the new session before the answer.').toBe(1)
  })

  test('A10 always: "Always allow for this profile" starts the session, the next session in the folder asks nothing, also after a restart, and another profile still asks', async ({
    chat
  }) => {
    await replyWithHello(chat)
    const folder = await createFolder(outside(chat, 'notes'))
    await writeProfiles(chat, [
      { prompt: 'Sort the notes', profile: 'personal', folder, createdAt: day(1) },
      { prompt: 'Summarize the notes', profile: 'client', folder, createdAt: day(2) }
    ])
    let page = await startWithProfiles(chat)
    await sendDraft(page, 'Sort the notes', 'A10 always')
    await expectOutsideQuestion(page, chat, 'A10 always', folder)
    await button(outsideQuestion(page), 'Always allow for this profile').click()
    await expect(outsideQuestion(page), 'A10 always: the directory question stays open after "Always allow for this profile".').toBeHidden()
    await expectReply(page, 'A10 always: after "Always allow for this profile"')

    await openNewSession(page)
    await startSession(page, 'Archive the old notes', 'A10 always')
    await expectReply(page, 'A10 always: the next session in the allowed folder')
    await expectNoQuestion(page, 'A10 always: the next session of "Personal" in the allowed folder')

    await chat.stop()
    page = await chat.start()
    await openNewSession(page)
    await startSession(page, 'Tag the notes', 'A10 always after a restart')
    await expectReply(page, 'A10 always: after a restart, the next session in the allowed folder')
    await expectNoQuestion(page, 'A10 always: after a restart, the next session of "Personal" in the allowed folder')

    // The answer belongs to "Personal". "Client Example" still asks for the same folder.
    const pids = chat.control.pids.length
    await switchProfile(page, PROFILES.personal, PROFILES.client)
    await sendDraft(page, 'Summarize the notes', 'A10 always')
    await expect(
      outsideQuestion(page),
      'A10 always: "Client Example" asks nothing for the folder that only "Personal" allowed, so the answer did not stay with its profile.'
    ).toBeVisible()
    expect(chat.control.pids, 'A10 always: an agent process started for "Client Example" before the answer.').toHaveLength(pids)
  })

  test('A10 another profile: a folder under the workspace directory of "Client Example" in a session of "Personal" names both profiles and the Claude folder that would read the files', async ({
    chat
  }) => {
    await replyWithHello(chat)
    const folder = await createFolder(join(directoryOf(chat, 'client'), 'contracts'))
    const claudeFolder = await createFolder(join(chat.root, 'claude', 'personal'))
    await writeProfiles(chat, [{ prompt: 'Read the contracts', profile: 'personal', folder, createdAt: day(1) }])
    const page = await startWithProfiles(chat)
    await setClaudeFolder(page, claudeFolder, 'A10 another profile')
    await sendDraft(page, 'Read the contracts', 'A10 another profile')

    const question = otherProfileQuestion(page)
    await expect(question, `A10 another profile: the first message in ${folder} shows no dialog "Use a folder of another profile?".`).toBeVisible()
    await expect(question, `A10 another profile: the question does not name the profile "${PROFILES.personal}" of the session.`).toContainText(PROFILES.personal)
    await expect(question, `A10 another profile: the question does not name the profile "${PROFILES.client}" that holds the folder.`).toContainText(PROFILES.client)
    await expect(question, `A10 another profile: the question does not name the Claude folder ${claudeFolder} that would read the files.`).toContainText(claudeFolder)
    expectNoAgentProcess(chat, 'A10 another profile', 'while the directory question shows')

    await button(question, 'Cancel').click()
    await expect(question, 'A10 another profile: the question stays open after "Cancel".').toBeHidden()
    expectNoAgentProcess(chat, 'A10 another profile', 'after Cancel of the directory question')
  })

  test('A10 no workspace directory: for a profile without a workspace directory, every folder is outside it', async ({ chat }) => {
    await replyWithHello(chat)
    // The folder lies where R would be, but the profile has no workspace directory.
    const folder = await createFolder(join(directoryOf(chat, 'personal'), 'repo-a'))
    await writeProfiles(chat, [{ prompt: 'Fix the login page', profile: 'personal', folder, createdAt: day(1) }])
    const page = await startWithoutDirectories(chat)
    await sendDraft(page, 'Fix the login page', 'A10 no workspace directory')
    await expectOutsideQuestion(page, chat, 'A10 no workspace directory', folder)
    await cancelOutsideQuestion(page, chat, 'A10 no workspace directory')
  })
})

test.describe('A10: Aether resolves a path before it compares it with the workspace directory', () => {
  test('A10 path with "..": R\\..\\..\\outside\\notes is outside the workspace directory R', async ({ chat }) => {
    await replyWithHello(chat)
    await createFolder(outside(chat, 'notes'))
    const folder = join(directoryOf(chat, 'personal'), '..', '..', 'outside', 'notes')
    // `path.join` resolves "..". Write the path with its ".." parts, as a user could type it.
    const typed = `${directoryOf(chat, 'personal')}\\..\\..\\outside\\notes`
    expect(typed.startsWith(directoryOf(chat, 'personal')), 'The test path must start with the text of R.').toBe(true)
    expect(folder, 'The test path must resolve outside R.').toBe(outside(chat, 'notes'))
    await writeProfiles(chat, [{ prompt: 'Sort the notes', profile: 'personal', folder: typed, createdAt: day(1) }])
    const page = await startWithProfiles(chat)
    await sendDraft(page, 'Sort the notes', 'A10 path with ".."')
    await expectOutsideQuestion(page, chat, 'A10 path with ".."', typed)
    await cancelOutsideQuestion(page, chat, 'A10 path with ".."')
  })

  test('A10 sibling folder: R-backup, whose name starts with the name of R, is outside the workspace directory R', async ({ chat }) => {
    await replyWithHello(chat)
    const folder = await createFolder(join(`${directoryOf(chat, 'personal')}-backup`, 'notes'))
    await writeProfiles(chat, [{ prompt: 'Sort the notes', profile: 'personal', folder, createdAt: day(1) }])
    const page = await startWithProfiles(chat)
    await sendDraft(page, 'Sort the notes', 'A10 sibling folder')
    await expectOutsideQuestion(page, chat, 'A10 sibling folder', folder)
    await cancelOutsideQuestion(page, chat, 'A10 sibling folder')
  })

  test('A10 junction: a junction in R that points outside R is outside the workspace directory', async ({ chat }) => {
    await replyWithHello(chat)
    const folder = await createJunction(join(directoryOf(chat, 'personal'), 'linked-notes'), outside(chat, 'notes'))
    await writeProfiles(chat, [{ prompt: 'Sort the notes', profile: 'personal', folder, createdAt: day(1) }])
    const page = await startWithProfiles(chat)
    await sendDraft(page, 'Sort the notes', 'A10 junction')
    await expectOutsideQuestion(page, chat, 'A10 junction', folder)
    await cancelOutsideQuestion(page, chat, 'A10 junction')
  })

  test('A10 letter case: with R saved in upper case, R/repo-b gets the trust question and not the directory question, and after Trust an upper-case spelling of repo-b asks nothing', async ({
    chat
  }) => {
    await replyWithHello(chat)
    const repository = await createRepository(join(directoryOf(chat, 'personal'), 'repo-b'), { hook: true })
    await writeProfiles(chat, [
      { prompt: 'Fix the login page', profile: 'personal', folder: repository, createdAt: day(1) },
      { prompt: 'List the open issues', profile: 'personal', folder: repository.toUpperCase(), createdAt: day(2) }
    ])
    const page = await startWithProfiles(chat, directoryOf(chat, 'personal').toUpperCase())

    await sendDraft(page, 'Fix the login page', 'A10 letter case')
    const question = trustQuestion(page)
    await expect(
      question,
      'A10 letter case: R/repo-b under R saved in upper case shows no trust question, so Aether did not see the repository under its workspace directory.'
    ).toBeVisible()
    await expect(outsideQuestion(page), 'A10 letter case: R/repo-b shows the directory question, so Aether compared the paths with their letter case.').toHaveCount(0)
    expectNoAgentProcess(chat, 'A10 letter case', 'before the trust answer')
    await button(question, 'Trust').click()
    await expectReply(page, 'A10 letter case: repo-b after Trust')

    await sendDraft(page, 'List the open issues', 'A10 letter case')
    await expectReply(page, 'A10 letter case: the upper-case spelling of the trusted repository repo-b')
    await expectNoQuestion(page, 'A10 letter case: the upper-case spelling of the trusted repository repo-b')
  })
})
