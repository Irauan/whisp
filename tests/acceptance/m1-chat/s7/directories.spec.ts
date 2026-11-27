// A15 with A10 of milestone m1-chat, on the built app: the S6 questions also guard the extra
// directories (`additionalDirectories`) of a session. S7 round 2, after the S6 merge.
//
// A15: a folder attachment outside the session folder is an additional directory of the agent.
// Brief, approach: "Attachment: folder outside the session folder. Also an additional directory,
// after the directory question."
// A9 and A10, and architecture, Directories and trust: no agent process starts before the trust
// answer or the directory answer. This includes a resume.
// S6 readings, accepted by the user on 2026-11-27: a plain folder with a `SessionStart` hook or a
// server in `.mcp.json` gets the trust question for that folder. Aether resolves `..`, junctions
// and letter case before it compares paths.
//
// The setup reuses the S6 fixture (`../s6/fixture.ts`): the launcher as Claude Code, two profiles,
// and the process list. The main folder of each session is R/repo-a, a plain folder without a hook
// or an MCP server, so S6 asks nothing for it. The extra directory comes from "Folder…" of "Add
// context", through the picker stub of the S7 fixture. Only the extra directory can cause a question.
// The UI contract is the one of S6 (questions) and S7 (attachments).
// No test sleeps. Each wait is an auto-waiting check of Playwright, or a report of the agent.
import { writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { addAttachment, paramsOf, samePath, send, stubPickers } from './fixture'
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
  HOOK_COMMAND,
  agentProcessIds,
  openNewSession,
  otherProfileQuestion,
  outside,
  outsideQuestion,
  replyWithHello,
  sessionEntry,
  startSession,
  startWithProfiles,
  test,
  trustQuestion,
  trustRefused,
  writeProfiles,
  type ChatApp
} from '../s6/fixture'

const SERVER = 'example-tools'

/** R/repo-a, the main folder: a plain folder, so S6 asks nothing for it. */
const mainFolder = (chat: ChatApp) => join(directoryOf(chat, 'personal'), 'repo-a')

/** The profile "Personal" with one draft in R/repo-a. The composer of a new session then starts with R/repo-a. */
async function startInMainFolder(chat: ChatApp): Promise<Page> {
  await replyWithHello(chat)
  await createFolder(mainFolder(chat))
  await writeProfiles(chat, [{ prompt: 'Rename the old files', profile: 'personal', folder: mainFolder(chat), createdAt: day(1) }])
  const page = await startWithProfiles(chat)
  await openNewSession(page)
  return page
}

/** Adds the folder as a folder attachment of the new session, then starts the session. */
async function startWithExtraDirectory(chat: ChatApp, page: Page, folder: string, label: string, prompt: string, check: string): Promise<void> {
  await stubPickers(chat, { files: [], folders: [folder] })
  await addAttachment(page, 'Folder…', label, check)
  await startSession(page, prompt, check)
}

/** The `additionalDirectories` of an ACP request. */
const extraDirectoriesOf = (params: Record<string, unknown>) =>
  Array.isArray(params.additionalDirectories) ? (params.additionalDirectories as unknown[]) : []

test.describe('A15 with A10: the S6 questions guard the extra directories of a session', () => {
  test('A15 with A10 untrusted extra directory: an extra directory in an untrusted Git repository asks the trust question, and no agent process starts while it is open', async ({
    chat
  }) => {
    const check = 'A15 with A10 untrusted extra directory'
    const page = await startInMainFolder(chat)
    const repository = await createRepository(join(directoryOf(chat, 'personal'), 'repo-b'), { hook: true, mcpServer: SERVER })
    await startWithExtraDirectory(chat, page, repository, 'repo-b', 'Compare the two folders', check)

    const question = trustQuestion(page)
    await expect(
      question,
      `${check}: the extra directory R/repo-b is an untrusted Git repository with a hook, but the start shows no dialog "Trust this repository?".`
    ).toBeVisible()
    await expect(question, `${check}: the trust question does not name the extra directory repo-b.`).toContainText('repo-b')
    await expect(question, `${check}: the trust question does not list the hook command of repo-b, "${HOOK_COMMAND}".`).toContainText(HOOK_COMMAND)
    await expect(question, `${check}: the trust question does not list the MCP server "${SERVER}" of repo-b.`).toContainText(SERVER)
    expectNoAgentProcess(chat, check, 'while the trust question for the extra directory shows')

    await button(question, 'Cancel').click()
    await expect(question, `${check}: the trust question stays open after "Cancel".`).toBeHidden()
    await expect(trustRefused(page), `${check}: the session window does not show the notice of the state Trust refused after Cancel.`).toBeVisible()
    expectNoAgentProcess(chat, check, 'after Cancel of the trust question for the extra directory')
  })

  test('A15 with A10 Trust: after "Trust", the start goes on and the agent gets the extra directory in session/new', async ({ chat }) => {
    const check = 'A15 with A10 Trust'
    const page = await startInMainFolder(chat)
    const repository = await createRepository(join(directoryOf(chat, 'personal'), 'repo-b'), { hook: true, mcpServer: SERVER })
    await startWithExtraDirectory(chat, page, repository, 'repo-b', 'Compare the two folders', check)

    const question = trustQuestion(page)
    await expect(
      question,
      `${check}: the extra directory R/repo-b is an untrusted Git repository with a hook, but the start shows no dialog "Trust this repository?".`
    ).toBeVisible()
    expectNoAgentProcess(chat, check, 'before the trust answer for the extra directory')
    await button(question, 'Trust').click()
    await expect(question, `${check}: the trust question stays open after "Trust".`).toBeHidden()
    await expectReply(page, check)

    // The start input of the simulated agent: the session runs in repo-a and reaches repo-b.
    const created = chat.control.received('session/new')
    expect(created, `${check}: the agent must get one session/new after Trust.`).toHaveLength(1)
    const params = paramsOf(created[0])
    expect(samePath(params.cwd, mainFolder(chat)), `${check}: the agent session must run in the main folder repo-a.`).toBe(true)
    expect(
      extraDirectoriesOf(params).some((path) => samePath(path, repository)),
      `${check}: session/new has no additionalDirectories entry for the trusted extra directory repo-b.`
    ).toBe(true)
  })

  test('A15 with A10 resume: after a restart, a resume with an extra directory that is not yet trusted asks the trust question before any agent process starts', async ({
    chat
  }) => {
    const check = 'A15 with A10 resume'
    const page = await startInMainFolder(chat)
    // R/tools: a plain folder with no hook and no MCP server, so the first start asks nothing.
    const tools = await createFolder(join(directoryOf(chat, 'personal'), 'tools'))
    await startWithExtraDirectory(chat, page, tools, 'tools', 'Use the tools folder', check)
    await expectReply(page, `${check}: the first start`)
    await expectNoQuestion(page, `${check}: the first start with the plain extra directory R/tools`)
    const first = paramsOf(chat.control.received('session/new')[0])
    expect(
      extraDirectoriesOf(first).some((path) => samePath(path, tools)),
      `${check} precondition: the first session/new has no additionalDirectories entry for R/tools.`
    ).toBe(true)

    // Between the runs, R/tools gets a project MCP server. It is not trusted yet.
    await chat.stop()
    const servers = { mcpServers: { [SERVER]: { command: 'node', args: ['tools/mcp-server.js'] } } }
    await writeFile(join(tools, '.mcp.json'), JSON.stringify(servers, null, 2))
    const processesBefore = chat.control.pids.length
    const restarted = await chat.start()
    const entry = sessionEntry(restarted, 'Use the tools folder')
    await expect(entry, `${check}: the sidebar does not list the session after the restart.`).toBeVisible()
    await entry.click()
    await send(restarted, 'Say it again', check)

    const question = trustQuestion(restarted)
    await expect(
      question,
      `${check}: the extra directory R/tools now has an MCP server and is not trusted, but the resume shows no dialog "Trust this repository?".`
    ).toBeVisible()
    await expect(question, `${check}: the trust question does not list the MCP server "${SERVER}" of R/tools.`).toContainText(SERVER)
    expect(chat.control.pids.length, `${check}: an agent process started while the trust question for the extra directory shows.`).toBe(processesBefore)
    expect(agentProcessIds(chat), `${check}: an agent process runs while the trust question for the extra directory shows.`).toEqual([])

    await button(question, 'Trust').click()
    await expectReply(restarted, `${check}: the resume after Trust`)
    const resumed = chat.control.received('session/resume')
    expect(resumed, `${check}: the agent must get one session/resume after Trust.`).toHaveLength(1)
    expect(
      extraDirectoriesOf(paramsOf(resumed[0])).some((path) => samePath(path, tools)),
      `${check}: session/resume has no additionalDirectories entry for R/tools.`
    ).toBe(true)
  })

  test('A15 with A10 junction: an extra directory given through a junction in the workspace directory gets the directory question of its real target outside it', async ({
    chat
  }) => {
    const check = 'A15 with A10 junction'
    const page = await startInMainFolder(chat)
    // R/shortcut looks like a folder of the workspace directory. Its real target is outside it.
    const target = await createFolder(outside(chat, 'tools'))
    const junction = await createJunction(join(directoryOf(chat, 'personal'), 'shortcut'), target)
    await startWithExtraDirectory(chat, page, junction, 'shortcut', 'Use the shortcut folder', check)

    const question = outsideQuestion(page)
    await expect(
      question,
      `${check}: the junction R/shortcut points outside the workspace directory, but the start shows no dialog "Use a folder outside the workspace directory?".`
    ).toBeVisible()
    expectNoAgentProcess(chat, check, 'while the directory question for the real target of the junction shows')
    await button(question, 'Cancel').click()
    await expect(question, `${check}: the directory question stays open after "Cancel".`).toBeHidden()
    expectNoAgentProcess(chat, check, 'after Cancel of the directory question')
  })

  test('A15 with A10 "..": an extra directory given with ".." gets the directory question of its real target, a folder of another profile', async ({
    chat
  }) => {
    const check = 'A15 with A10 ".."'
    const page = await startInMainFolder(chat)
    // The path starts in R/repo-a and ends in the workspace directory of "Client Example".
    const real = await createFolder(join(directoryOf(chat, 'client'), 'shared'))
    const spelled = `${mainFolder(chat)}\\..\\..\\client\\shared`
    expect(samePath(resolve(spelled), real),`${check} precondition: the path with ".." must end in the folder of "Client Example".`).toBe(true)
    await startWithExtraDirectory(chat, page, spelled, 'shared', 'Use the shared folder', check)

    const question = otherProfileQuestion(page)
    await expect(
      question,
      `${check}: the path with ".." ends in the workspace directory of "Client Example", but the start shows no dialog "Use a folder of another profile?".`
    ).toBeVisible()
    expectNoAgentProcess(chat, check, 'while the directory question for the real target of the path shows')
    await button(question, 'Cancel').click()
    await expect(question, `${check}: the directory question stays open after "Cancel".`).toBeHidden()
    expectNoAgentProcess(chat, check, 'after Cancel of the directory question')
  })
})
