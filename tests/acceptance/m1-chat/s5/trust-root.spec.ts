// S5-13 and S5-14 of milestone m1-chat: the repository root in the trust question of S6, on the
// built app.
//
// S5-13: a session folder under R, in a Git repository whose root holds R, and a second case where
// the root equals R. The trust question shows the facts "Repository" and "Repository root", and the
// warning that names R and the profile.
// S5-14: a session folder in a repository inside R. The trust question shows the root path and no
// warning.
//
// User decision, 2026-11-27 (spec, "The S6 trust question"): the dialog keeps the fact "Repository",
// adds the fact "Repository root" with the path, and warns when the root holds the workspace
// directory: "This repository holds the workspace directory <R>. Trust covers every plain folder under
// <R> for the profile <name>." The buttons stay "Cancel" and "Trust". The dialog stays the app-level
// `dialog` of S6.
//
// The setup is the S6 fixture: the launcher of `s6/claude-hooks.mjs` as Claude Code, the profiles
// "Personal" (R) and "Client Example", and real Git repositories (`git init`). Each folder is a plain
// folder or a repository under the temporary folder of the test. No test sleeps.
import { join } from 'node:path'
import {
  button,
  createFolder,
  createRepository,
  day,
  directoryOf,
  expect,
  expectNoAgentProcess,
  sendDraft,
  startWithProfiles,
  test,
  trustQuestion,
  writeProfiles,
  type ChatApp
} from '../s6/fixture'

const PROFILE = 'Personal'

/** A pattern for a path as text: the case does not count, as on Windows. */
const pathText = (path: string) => new RegExp(path.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')

/** The warning of the spec, for the workspace directory R and the profile. */
const warningOf = (directory: string) => {
  const path = directory.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`This repository holds the workspace directory ${path}\\. Trust covers every plain folder under ${path} for the profile ${PROFILE}\\.`, 'i')
}

/** Sends the first message of a draft in `folder`, and returns the trust question that it shows. */
async function askTrust(chat: ChatApp, folder: string, check: string) {
  await writeProfiles(chat, [{ prompt: 'Fix the login page', profile: 'personal', folder, createdAt: day(1) }])
  const page = await startWithProfiles(chat)
  await sendDraft(page, 'Fix the login page', check)
  const question = trustQuestion(page)
  await expect(question, `${check}: the first message in ${folder} shows no dialog "Trust this repository?".`).toBeVisible()
  return { page, question }
}

/** Checks the facts of the question: "Repository" with the name of the root folder, and "Repository root" with its path. */
async function expectRoot(question: ReturnType<typeof trustQuestion>, root: string, name: string, check: string): Promise<void> {
  await expect(question, `${check}: the trust question must keep the fact "Repository".`).toContainText('Repository')
  await expect(question, `${check}: the fact "Repository" must name the repository "${name}".`).toContainText(name)
  await expect(question, `${check}: the trust question must show the fact "Repository root".`).toContainText('Repository root')
  await expect(question, `${check}: the fact "Repository root" must show the path ${root}.`).toContainText(pathText(root))
  await expect(button(question, 'Trust'), `${check}: the trust question must keep the button "Trust".`).toBeVisible()
  await expect(button(question, 'Cancel'), `${check}: the trust question must keep the button "Cancel".`).toBeVisible()
}

test.describe('S5-13 and S5-14: the repository root in the trust question', () => {
  test('S5-13 root above R: a folder under R in a repository whose root holds R shows "Repository", "Repository root" and the warning that names R and the profile', async ({
    chat
  }) => {
    const check = 'S5-13 (root above R)'
    const directory = directoryOf(chat, 'personal')
    // The repository root is the folder that holds R, as a dotfiles repository in the home folder does.
    const root = await createRepository(join(directory, '..'))
    const folder = await createFolder(join(directory, 'repo-a'))
    const { question } = await askTrust(chat, folder, check)
    await expectRoot(question, root, 'directories', check)
    await expect(question, `${check}: the trust question must warn that the repository holds the workspace directory ${directory}.`).toContainText(warningOf(directory))
    expectNoAgentProcess(chat, check, 'while the trust question shows')
    await button(question, 'Cancel').click()
    await expect(question).toBeHidden()
  })

  test('S5-13 root equals R: a folder under R in a repository whose root is R shows "Repository root" and the warning that names R and the profile', async ({
    chat
  }) => {
    const check = 'S5-13 (root equals R)'
    const directory = directoryOf(chat, 'personal')
    const root = await createRepository(directory)
    const folder = await createFolder(join(directory, 'repo-a'))
    const { question } = await askTrust(chat, folder, check)
    await expectRoot(question, root, 'personal', check)
    await expect(question, `${check}: a repository root equal to R holds R, so the trust question must warn.`).toContainText(warningOf(directory))
    await button(question, 'Cancel').click()
    await expect(question).toBeHidden()
  })

  test('S5-14: a folder in a repository inside R shows the repository root path and no warning', async ({ chat }) => {
    const check = 'S5-14'
    const directory = directoryOf(chat, 'personal')
    const root = await createRepository(join(directory, 'repo-b'))
    const folder = await createFolder(join(root, 'app'))
    const { question } = await askTrust(chat, folder, check)
    await expectRoot(question, root, 'repo-b', check)
    await expect(question, `${check}: a repository inside R must show no warning about the workspace directory.`).not.toContainText(/holds the workspace directory/i)
    await button(question, 'Cancel').click()
    await expect(question).toBeHidden()
  })
})
