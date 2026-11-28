// A15 of milestone m1-chat, on the built app with the simulated agent.
//
// A15: a file attachment and a folder outside the session folder. The session starts. The first
// message has a resource link for each. The folder is an additional directory.
// Brief, approach: a file or folder attachment is a resource link in the first message. A folder
// outside the session folder is also an additional directory, after the directory question.
//
// The session folder is `repo-a`. The file is `repo-a/notes.txt`. The folder is `repo-b`: a plain
// folder under the workspace directory, so the directory question of story S6 does not apply to it
// (architecture, Directories and trust). The fixture explains how S6 can change this.
// No test sleeps. Each wait is an auto-waiting check of Playwright, or a report of the agent.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  addAttachment,
  DRAFT_IN_REPO_A,
  expect,
  expectInTranscript,
  folderPath,
  paramsOf,
  pathOfUri,
  samePath,
  startImported,
  startSession,
  stubPickers,
  test,
  writeOldProfile
} from './fixture'

test.describe('A15: file and folder attachments reach the agent', () => {
  test('A15: the first message has a resource link for the file and for the folder outside the session folder, and the folder is an additional directory', async ({
    chat
  }) => {
    const check = 'A15'
    await chat.control.scenario('text', { chunks: ['Read ', 'them.'] })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const sessionFolder = folderPath(chat, 'repo-a')
    const outsideFolder = folderPath(chat, 'repo-b')
    const file = join(sessionFolder, 'notes.txt')
    await writeFile(file, 'Fake notes for the test.\n')
    await writeFile(join(outsideFolder, 'readme.txt'), 'A fake file in the other folder.\n')

    const page = await startImported(chat)
    await stubPickers(chat, { files: [file], folders: [outsideFolder] })
    await addAttachment(page, 'Files…', 'notes.txt', check)
    await addAttachment(page, 'Folder…', 'repo-b', check)
    await startSession(page, 'Read the attachments', check)
    await expectInTranscript(page, 'Read them.', `${check}: the session gets no reply.`)
    await expect.poll(() => chat.control.received('session/prompt').length, { message: `${check}: the agent got no prompt.` }).toBe(1)

    // The session runs in repo-a, and repo-b is an additional directory of the agent session.
    const created = chat.control.received('session/new')
    expect(created, `${check}: the agent must get one session/new.`).toHaveLength(1)
    const folders = paramsOf(created[0])
    expect(samePath(folders.cwd, sessionFolder), `${check}: the agent session must run in the session folder repo-a.`).toBe(true)
    const additional = Array.isArray(folders.additionalDirectories) ? folders.additionalDirectories : []
    // Soft checks: each missing part of A15 shows its own message.
    expect.soft(
      additional.some((path) => samePath(path, outsideFolder)),
      `${check}: session/new has no additionalDirectories entry for the folder repo-b outside the session folder.`
    ).toBe(true)

    // The first message: the text of the user and a resource link for each attachment.
    const prompt = paramsOf(chat.control.received('session/prompt')[0]).prompt
    const blocks = (Array.isArray(prompt) ? prompt : []) as Record<string, unknown>[]
    expect(
      blocks.some((block) => block.type === 'text' && typeof block.text === 'string' && block.text.includes('Read the attachments')),
      `${check}: the first message lost the text of the user.`
    ).toBe(true)
    const links = blocks.filter((block) => block.type === 'resource_link')
    expect.soft(
      links.some((link) => samePath(pathOfUri(link.uri), file)),
      `${check}: the first message has no resource_link for the file notes.txt.`
    ).toBe(true)
    expect.soft(
      links.some((link) => samePath(pathOfUri(link.uri), outsideFolder)),
      `${check}: the first message has no resource_link for the folder repo-b.`
    ).toBe(true)
  })
})
