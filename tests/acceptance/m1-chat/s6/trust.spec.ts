// A9 of milestone m1-chat, on the built app. It covers the defect "A repository runs its hooks and
// MCP servers at session start, without a question." of `docs/architecture.md`.
//
// A9: repository R/repo-b, not trusted, with a `SessionStart` hook and `.mcp.json`. The user sends
// the first message. The trust question lists the hook and the MCP server. No agent process exists.
// Cancel leaves no process and the hook does not run.
// States table, Trust refused: "Aether did not start the agent in this repository."
// Architecture, Directories and trust: a session directory in a trusted repository starts the
// session. Trust applies to one repository, not to the whole workspace directory. No agent process
// starts before the trust answer.
// Decision 0007: Aether asks for trust once per repository.
// User decisions, 2026-11-27: a plain folder with a hook or an MCP server gets the trust question
// for that folder. Trust answers belong to one profile.
//
// The fixture describes the UI contract, the launcher that runs the hooks as Claude does, and the
// readings of S6. No test sleeps. Each wait is an auto-waiting check of Playwright.
import { join } from 'node:path'
import {
  button,
  createFolder,
  createPlainFolderWith,
  createRepository,
  day,
  directoryOf,
  expect,
  expectNoAgentProcess,
  expectNoQuestion,
  expectReply,
  HOOK_COMMAND,
  hookRan,
  mcpServerStarted,
  openNewSession,
  PROFILES,
  replyWithHello,
  sendDraft,
  startSession,
  startWithProfiles,
  switchProfile,
  test,
  trustQuestion,
  trustRefused,
  writeProfiles,
  type ChatApp
} from './fixture'

const SERVER_B = 'example-tools'
const SERVER_C = 'example-search'

/** R/repo-b: a Git repository with a `SessionStart` hook and an MCP server. */
const repoB = (chat: ChatApp) => createRepository(join(directoryOf(chat, 'personal'), 'repo-b'), { hook: true, mcpServer: SERVER_B })

test.describe('A9: the trust question of a repository', () => {
  test('A9 question and Cancel: the first message in R/repo-b shows the hook and the MCP server, no agent process exists, and Cancel leaves no process, runs no hook and shows "Trust refused"', async ({
    chat
  }) => {
    await replyWithHello(chat)
    const repository = await repoB(chat)
    await writeProfiles(chat, [{ prompt: 'Fix the login page', profile: 'personal', folder: repository, createdAt: day(1) }])
    const page = await startWithProfiles(chat)
    await sendDraft(page, 'Fix the login page', 'A9')

    // The question lists the hook and the MCP server that Aether found.
    const question = trustQuestion(page)
    await expect(question, 'A9: the first message in the untrusted repository R/repo-b shows no dialog "Trust this repository?".').toBeVisible()
    await expect(question, 'A9: the trust question does not name the repository repo-b.').toContainText('repo-b')
    await expect(question, 'A9: the trust question does not list the hook event SessionStart.').toContainText('SessionStart')
    await expect(question, `A9: the trust question does not list the command of the hook, "${HOOK_COMMAND}".`).toContainText(HOOK_COMMAND)
    await expect(question, `A9: the trust question does not list the MCP server "${SERVER_B}" of .mcp.json.`).toContainText(SERVER_B)
    expectNoAgentProcess(chat, 'A9', 'while the trust question shows')

    // Cancel: no process, no hook, no MCP server, and the notice of the state Trust refused.
    await button(question, 'Cancel').click()
    await expect(question, 'A9: the trust question stays open after "Cancel".').toBeHidden()
    await expect(trustRefused(page), 'A9 (Trust refused): the session window does not show "Aether did not start the agent in this repository." after Cancel.').toBeVisible()
    expectNoAgentProcess(chat, 'A9', 'after Cancel of the trust question')
    expect(await hookRan(repository), 'A9: the SessionStart hook of repo-b ran after Cancel.').toBe(false)
    expect(await mcpServerStarted(repository), 'A9: the MCP server of repo-b started after Cancel.').toBe(false)

    await chat.stop()
    expectNoAgentProcess(chat, 'A9', 'after Cancel and the exit of Aether')
    expect(await hookRan(repository), 'A9: the SessionStart hook of repo-b ran after Cancel.').toBe(false)
  })

  test('A9 Trust: Trust starts the session in R/repo-b, and a second session in R/repo-b asks nothing, also after a restart', async ({ chat }) => {
    await replyWithHello(chat)
    const repository = await repoB(chat)
    await writeProfiles(chat, [{ prompt: 'Fix the login page', profile: 'personal', folder: repository, createdAt: day(1) }])
    let page = await startWithProfiles(chat)
    await sendDraft(page, 'Fix the login page', 'A9 Trust')

    const question = trustQuestion(page)
    await expect(question, 'A9 Trust: the first message in the untrusted repository R/repo-b shows no dialog "Trust this repository?".').toBeVisible()
    expectNoAgentProcess(chat, 'A9 Trust', 'before the trust answer')
    await button(question, 'Trust').click()
    await expect(question, 'A9 Trust: the trust question stays open after "Trust".').toBeHidden()
    await expectReply(page, 'A9 Trust')
    await expect(trustRefused(page), 'A9 Trust: the notice of the state Trust refused shows after Trust.').toHaveCount(0)
    // The launcher ran the hook as Claude does. This shows that the check of Cancel above has a meaning.
    expect(await hookRan(repository), 'A9 Trust: the SessionStart hook did not run after Trust, so the launcher of the fixture does not work.').toBe(true)
    expect(await mcpServerStarted(repository), 'A9 Trust: the MCP server did not start after Trust, so the launcher of the fixture does not work.').toBe(true)

    // A second session in the same repository asks nothing. The composer starts with repo-b.
    await openNewSession(page)
    await startSession(page, 'List the open issues', 'A9 Trust')
    await expectReply(page, 'A9 Trust: the second session in the trusted repository repo-b')
    await expectNoQuestion(page, 'A9 Trust: a second session in the trusted repository repo-b')
    expect(new Set(chat.control.pids).size, 'A9 Trust: the second session must start its own agent process.').toBe(2)

    // The answer is stored: after a restart, a new session in repo-b asks nothing (decision 0007: once per repository).
    await chat.stop()
    page = await chat.start()
    await openNewSession(page)
    await startSession(page, 'Write the release notes', 'A9 Trust after a restart')
    await expectReply(page, 'A9 Trust: after a restart, the new session in the trusted repository repo-b')
    await expectNoQuestion(page, 'A9 Trust: after a restart, a new session in the trusted repository repo-b')
  })

  test('A9 one repository: Trust of R/repo-b covers a folder inside repo-b, but R/repo-c in the same workspace directory still asks, with its own hook and MCP server', async ({
    chat
  }) => {
    await replyWithHello(chat)
    const personal = directoryOf(chat, 'personal')
    const b = await repoB(chat)
    const c = await createRepository(join(personal, 'repo-c'), { hook: true, mcpServer: SERVER_C })
    const inside = await createFolder(join(b, 'packages', 'app'))
    await writeProfiles(chat, [
      { prompt: 'Fix the login page', profile: 'personal', folder: b, createdAt: day(1) },
      { prompt: 'Update the app package', profile: 'personal', folder: inside, createdAt: day(2) },
      { prompt: 'Index the documents', profile: 'personal', folder: c, createdAt: day(3) }
    ])
    const page = await startWithProfiles(chat)

    await sendDraft(page, 'Fix the login page', 'A9 one repository')
    const question = trustQuestion(page)
    await expect(question, 'A9 one repository: the first message in R/repo-b shows no dialog "Trust this repository?".').toBeVisible()
    await button(question, 'Trust').click()
    await expectReply(page, 'A9 one repository: repo-b after Trust')

    // A session folder inside the trusted repository: the session starts.
    await sendDraft(page, 'Update the app package', 'A9 one repository')
    await expectReply(page, 'A9 one repository: the folder packages/app inside the trusted repository repo-b')
    await expectNoQuestion(page, 'A9 one repository: a folder inside the trusted repository repo-b')

    // Another repository of the same workspace directory: Aether asks again, with its own items.
    const pids = chat.control.pids.length
    await sendDraft(page, 'Index the documents', 'A9 one repository')
    await expect(question, 'A9 one repository: R/repo-c shows no trust question, so the trust of repo-b covered the whole workspace directory.').toBeVisible()
    await expect(question, 'A9 one repository: the trust question for repo-c does not name repo-c.').toContainText('repo-c')
    await expect(question, `A9 one repository: the trust question for repo-c does not list its MCP server "${SERVER_C}".`).toContainText(SERVER_C)
    await expect(question, `A9 one repository: the trust question for repo-c lists the MCP server "${SERVER_B}" of repo-b.`).not.toContainText(SERVER_B)
    expect(chat.control.pids, 'A9 one repository: an agent process started for repo-c before the trust answer.').toHaveLength(pids)
    await button(question, 'Cancel').click()
    await expect(trustRefused(page), 'A9 one repository (Trust refused): Cancel for repo-c does not show "Aether did not start the agent in this repository.".').toBeVisible()
    expect(chat.control.pids, 'A9 one repository: an agent process started for repo-c after Cancel.').toHaveLength(pids)
    expect(await hookRan(c), 'A9 one repository: the SessionStart hook of repo-c ran after Cancel.').toBe(false)
  })
})

test.describe('A9: a plain folder with a hook or an MCP server (user decision, 2026-11-27)', () => {
  /** R/notes-tool: a plain folder, not a Git repository, with a `SessionStart` hook and an MCP server. */
  const plainFolder = (chat: ChatApp) =>
    createPlainFolderWith(join(directoryOf(chat, 'personal'), 'notes-tool'), { hook: true, mcpServer: SERVER_B })

  /** Sends the draft in the plain folder and checks the trust question with both items, while no agent process exists. */
  async function expectPlainFolderQuestion(chat: ChatApp, check: string) {
    const folder = await plainFolder(chat)
    await writeProfiles(chat, [{ prompt: 'Sort the notes', profile: 'personal', folder, createdAt: day(1) }])
    const page = await startWithProfiles(chat)
    await sendDraft(page, 'Sort the notes', check)
    const question = trustQuestion(page)
    await expect(
      question,
      `${check}: the first message in the plain folder R/notes-tool, which has a SessionStart hook and .mcp.json, shows no dialog "Trust this repository?".`
    ).toBeVisible()
    await expect(question, `${check}: the trust question does not name the folder notes-tool.`).toContainText('notes-tool')
    await expect(question, `${check}: the trust question does not list the hook event SessionStart.`).toContainText('SessionStart')
    await expect(question, `${check}: the trust question does not list the command of the hook, "${HOOK_COMMAND}".`).toContainText(HOOK_COMMAND)
    await expect(question, `${check}: the trust question does not list the MCP server "${SERVER_B}" of .mcp.json.`).toContainText(SERVER_B)
    expectNoAgentProcess(chat, check, 'while the trust question for the plain folder shows')
    return { page, folder, question }
  }

  test('A9 plain folder and Cancel: a plain folder under R with a SessionStart hook and .mcp.json gets the trust question with both, and Cancel runs nothing', async ({
    chat
  }) => {
    await replyWithHello(chat)
    const { folder, question } = await expectPlainFolderQuestion(chat, 'A9 plain folder')
    await button(question, 'Cancel').click()
    await expect(question, 'A9 plain folder: the trust question stays open after "Cancel".').toBeHidden()
    expectNoAgentProcess(chat, 'A9 plain folder', 'after Cancel of the trust question')
    expect(await hookRan(folder), 'A9 plain folder: the SessionStart hook of the plain folder ran after Cancel.').toBe(false)
    expect(await mcpServerStarted(folder), 'A9 plain folder: the MCP server of the plain folder started after Cancel.').toBe(false)
    await chat.stop()
    expectNoAgentProcess(chat, 'A9 plain folder', 'after Cancel and the exit of Aether')
  })

  test('A9 plain folder and Trust: Trust starts the session in the plain folder with a hook and .mcp.json', async ({ chat }) => {
    await replyWithHello(chat)
    const { page, folder, question } = await expectPlainFolderQuestion(chat, 'A9 plain folder Trust')
    await button(question, 'Trust').click()
    await expect(question, 'A9 plain folder Trust: the trust question stays open after "Trust".').toBeHidden()
    await expectReply(page, 'A9 plain folder Trust')
    expect(await hookRan(folder), 'A9 plain folder Trust: the SessionStart hook did not run after Trust, so the launcher of the fixture does not work.').toBe(true)
  })
})

test.describe('A9: trust belongs to one profile (user decision, 2026-11-27)', () => {
  test('A9 per profile: after "Personal" trusts R/repo-b, a session of "Client Example" in R/repo-b still gets the trust question', async ({
    chat
  }) => {
    await replyWithHello(chat)
    const repository = await repoB(chat)
    await writeProfiles(chat, [
      { prompt: 'Fix the login page', profile: 'personal', folder: repository, createdAt: day(1) },
      { prompt: 'Review the login page', profile: 'client', folder: repository, createdAt: day(2) }
    ])
    // Both profiles have the workspace directory R, so repo-b is under the workspace directory of each.
    const page = await startWithProfiles(chat, directoryOf(chat, 'personal'), directoryOf(chat, 'personal'))

    await sendDraft(page, 'Fix the login page', 'A9 per profile')
    const question = trustQuestion(page)
    await expect(question, 'A9 per profile: the first message of "Personal" in R/repo-b shows no dialog "Trust this repository?".').toBeVisible()
    await button(question, 'Trust').click()
    await expectReply(page, 'A9 per profile: repo-b in "Personal" after Trust')

    const pids = chat.control.pids.length
    await switchProfile(page, PROFILES.personal, PROFILES.client)
    await sendDraft(page, 'Review the login page', 'A9 per profile')
    await expect(
      question,
      'A9 per profile: a session of "Client Example" in R/repo-b shows no trust question, so the trust of "Personal" counted for "Client Example".'
    ).toBeVisible()
    expect(chat.control.pids, 'A9 per profile: an agent process started for "Client Example" before the trust answer.').toHaveLength(pids)
    await button(question, 'Cancel').click()
    await expect(question, 'A9 per profile: the trust question stays open after "Cancel".').toBeHidden()
    expect(chat.control.pids, 'A9 per profile: an agent process started for "Client Example" after Cancel.').toHaveLength(pids)
  })
})
