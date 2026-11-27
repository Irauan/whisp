// The fixture of the S6 tests of milestone m1-chat: A9 and A10, repository and directory trust.
//
// It reuses the app fixture of S4 (`../s4/fixture.ts`): the built app in a temporary data folder,
// a temporary APPDATA and home, the fake `gh`, the simulated agent, and the check that the real
// data folder (`%APPDATA%\aether`) does not change. All data is fake. The product has no test hook.
//
// The agent. `agents.json` registers `claude-hooks.mjs` of this folder as Claude Code. It runs the
// simulated agent, and before each session start it runs the `SessionStart` hooks and the MCP
// servers of the session folder, as Claude does (decision 0007). So a hook that runs leaves its
// marker file, and the check "the hook does not run" of A9 has a meaning.
//
// The data. The old `workspace.json` holds two profiles, "Personal" and "Client Example", and the
// session drafts of a test. Each draft can have any folder. Send in a draft starts it (flow 6), so
// a test reaches each folder without the folder picker of the system.
// - Workspace directory of "Personal": R, `<root>\directories\personal`.
// - Workspace directory of "Client Example": `<root>\directories\client`.
// - Folders outside both: under `<root>\outside`.
// - A repository is a real Git repository (`git init`). A plain folder is not.
//
// Readings of S6 (the coordinator sends each to the user when the documents do not answer it):
// - A plain folder (not in a Git repository) under the workspace directory of the profile: S6 asks
//   nothing, as in S4. `docs/architecture.md` defines a repository as a Git repository, and its
//   table has no case for such a folder. No S6 test covers it. The S3 and S4 tests stay unchanged.
// - A session folder inside a trusted repository asks nothing (table: "Session directory in a
//   trusted repository"). Trust covers the Git repository, not one folder of it.
// - "Allow once" covers one session. A new session in the same folder asks again.
// - "Always allow for this profile" covers that folder for that profile, also after a restart.
// - A profile without a workspace directory: every folder is outside it. The user leaves the
//   import dialog with Escape, so the profile keeps no workspace directory (migration `001`).
// - Path comparison: Aether resolves `..`, junctions and letter case before it compares. A sibling
//   folder whose name starts with the name of the workspace directory is outside it.
// - The Claude account that would read the files is the current Claude account of the profile of
//   the session. The question names it by its Claude folder.
//
// The UI that these tests expect (S6 test contract). The S1 to S4 contracts stay. The tests find
// each question by role and name. They do not fix its place.
// - Trust question: a `dialog` named exactly "Trust this repository?". It shows the name of the
//   repository folder, each `SessionStart` hook with the event name and its command, and the name
//   of each MCP server of `.mcp.json`. It has the buttons "Trust" and "Cancel".
// - Trust starts the session. Cancel closes the question and starts no agent. The session window
//   then shows the exact text "Aether did not start the agent in this repository." (Trust refused).
// - Directory question, folder outside the workspace directory: a `dialog` named exactly "Use a
//   folder outside the workspace directory?". It has the buttons "Allow once", "Always allow for
//   this profile" and "Cancel".
// - Directory question, folder under the workspace directory of another profile: a `dialog` named
//   exactly "Use a folder of another profile?". It shows the name of the profile of the session,
//   the name of the other profile, and the Claude folder of the Claude account that would read the
//   files. It has the button "Cancel". The tests check no other answer of this question.
// - Before any answer, no agent process exists. Cancel of any question leaves no agent process.
//
// No test sleeps. A test waits on an auto-waiting check of Playwright, or on a report of the agent.
import { spawnSync } from 'node:child_process'
import { access, mkdir, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { answerDirectoryDialog, DIRECTORY_DIALOG } from '../s2/fixture'
import { test as chatTest, expect, expectInTranscript, main, promptField, sendButton, sessionEntry, type ChatApp } from '../s4/fixture'

export { expect, type ChatApp }
export { expectInTranscript, main, openNewSession, sessionEntry, setClaudeFolder, startSession } from '../s4/fixture'
export { switchProfile } from '../s3/fixture'

/** The launcher that runs the simulated agent with the session start of Claude. */
const LAUNCHER = resolve(__dirname, 'claude-hooks.mjs')

/** The S4 app fixture, with the launcher as Claude Code in `agents.json` before the first start. */
export const test = chatTest.extend<{ chat: ChatApp }>({
  chat: async ({ chat }, use) => {
    const { command, args } = chat.control.agent
    // `args` is [agent.mjs, pipe name]. The launcher takes the same arguments as the agent.
    await writeFile(
      join(chat.dataDir, 'agents.json'),
      JSON.stringify({ agents: [{ id: 'claude-code', name: 'Claude Code', command, args: [LAUNCHER, ...args.slice(1)] }] }, null, 2)
    )
    await use(chat)
  }
})

export const PROFILES = { personal: 'Personal', client: 'Client Example' } as const
export type Profile = keyof typeof PROFILES

/** The workspace directory of a profile. The one of "Personal" is R, the folder of the S4 fixture. */
export const directoryOf = (chat: ChatApp, profile: Profile) =>
  profile === 'personal' ? chat.directory : join(chat.root, 'directories', 'client')

/** A folder outside the workspace directories of both profiles. */
export const outside = (chat: ChatApp, name: string) => join(chat.root, 'outside', name)

/** The reply of the simulated agent in these tests. */
export const REPLY = 'Hello from the agent.'

/** Each session start replies with `REPLY`. */
export const replyWithHello = (chat: ChatApp) => chat.control.scenario('text', { chunks: ['Hello ', 'from the agent.'] })

// Repositories and folders.

/** The command of the `SessionStart` hook of each test repository. */
export const HOOK_COMMAND = 'node .claude/hooks/session-start.js'
/** The file that the hook writes in the repository when it runs. */
export const HOOK_MARKER = 'session-start-hook-ran.txt'
/** The file that an MCP server writes in the repository when it starts. */
export const MCP_MARKER = 'mcp-server-started.txt'

export interface RepositoryContent {
  /** A `SessionStart` hook in `.claude/settings.json`. */
  hook?: boolean
  /** The name of a server in `.mcp.json`. */
  mcpServer?: string
}

/** Creates a plain folder: no Git repository, no hook, no `.mcp.json`. */
export async function createFolder(path: string): Promise<string> {
  await mkdir(path, { recursive: true })
  return path
}

/** Creates a real Git repository, with a `SessionStart` hook and an MCP server when asked. */
export async function createRepository(path: string, content: RepositoryContent = {}): Promise<string> {
  await mkdir(path, { recursive: true })
  const init = spawnSync('git', ['init', '--quiet', path], { encoding: 'utf8', windowsHide: true })
  if (init.error || init.status !== 0) {
    throw new Error(`git init failed in ${path}: ${init.error?.message ?? init.stderr}`)
  }
  if (content.hook) {
    await mkdir(join(path, '.claude', 'hooks'), { recursive: true })
    const settings = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: HOOK_COMMAND }] }] } }
    await writeFile(join(path, '.claude', 'settings.json'), JSON.stringify(settings, null, 2))
    await writeFile(
      join(path, '.claude', 'hooks', 'session-start.js'),
      `require('node:fs').writeFileSync(require('node:path').join(__dirname, '..', '..', '${HOOK_MARKER}'), 'SessionStart')\n`
    )
  }
  if (content.mcpServer) {
    await mkdir(join(path, 'tools'), { recursive: true })
    const servers = { mcpServers: { [content.mcpServer]: { command: 'node', args: ['tools/mcp-server.js'] } } }
    await writeFile(join(path, '.mcp.json'), JSON.stringify(servers, null, 2))
    await writeFile(
      join(path, 'tools', 'mcp-server.js'),
      `require('node:fs').writeFileSync(require('node:path').join(__dirname, '..', '${MCP_MARKER}'), 'started')\n`
    )
  }
  return path
}

/** Creates a junction at `path` that points to the folder `target`. */
export async function createJunction(path: string, target: string): Promise<string> {
  await mkdir(target, { recursive: true })
  await mkdir(join(path, '..'), { recursive: true })
  await symlink(target, path, 'junction')
  return path
}

const exists = async (path: string) =>
  access(path).then(
    () => true,
    () => false
  )

/** True when the `SessionStart` hook of the repository ran. */
export const hookRan = (repository: string) => exists(join(repository, HOOK_MARKER))
/** True when the MCP server of the repository started. */
export const mcpServerStarted = (repository: string) => exists(join(repository, MCP_MARKER))

// The old file.

/** One session draft of the old file. */
export interface Draft {
  prompt: string
  profile: Profile
  /** The folder of the draft, as the old file holds it. */
  folder: string
  /** The newest draft of a profile gives the folder of a new session of that profile. */
  createdAt: string
}

/** The creation time of day `n` of January 2026. */
export const day = (n: number) => `2026-01-${String(n).padStart(2, '0')}T00:00:00.000Z`

/** Writes the old `workspace.json` of version 4 with both profiles and the drafts. Creates both workspace directories. */
export async function writeProfiles(chat: ChatApp, drafts: Draft[]): Promise<void> {
  for (const profile of Object.keys(PROFILES) as Profile[]) await mkdir(directoryOf(chat, profile), { recursive: true })
  const file = {
    version: 4,
    accounts: [
      { id: 'personal', label: PROFILES.personal, github: null },
      { id: 'client', label: PROFILES.client, github: null }
    ],
    currentAccountId: 'personal',
    projects: [],
    workItems: [],
    sessions: drafts.map((draft, index) => ({
      id: `session-${index + 1}`,
      accountId: draft.profile,
      title: draft.prompt,
      prompt: draft.prompt,
      settings: {
        folder: draft.folder,
        mode: 'interactive',
        permissions: 'ask',
        model: 'default',
        checkout: 'folder',
        attachments: []
      },
      createdAt: draft.createdAt
    }))
  }
  await writeFile(join(chat.dataDir, 'workspace.json'), JSON.stringify(file, null, 2))
}

/**
 * Starts the app on the old file and answers the import dialog of flow 1. A test can give the
 * workspace directory of "Personal" in another spelling, for example in upper case.
 */
export async function startWithProfiles(chat: ChatApp, personalDirectory = directoryOf(chat, 'personal')): Promise<Page> {
  const page = await chat.start()
  await answerDirectoryDialog(page, { [PROFILES.personal]: personalDirectory, [PROFILES.client]: directoryOf(chat, 'client') })
  return page
}

/** Starts the app on the old file and leaves the import dialog with Escape: no profile gets a workspace directory. */
export async function startWithoutDirectories(chat: ChatApp): Promise<Page> {
  const page = await chat.start()
  const dialog = page.getByRole('dialog', { name: DIRECTORY_DIALOG })
  await expect(dialog, `The dialog "${DIRECTORY_DIALOG}" of flow 1 does not show.`).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog, `The dialog "${DIRECTORY_DIALOG}" does not close on Escape.`).toBeHidden()
  return page
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

/** Checks that the session window shows the reply of the agent. */
export const expectReply = (page: Page, check: string) =>
  expectInTranscript(page, REPLY, `${check}: the session window does not show the reply "${REPLY}" of the agent, so the session did not start.`)

// The questions of the S6 contract.

export const TRUST_QUESTION = 'Trust this repository?'
export const OUTSIDE_QUESTION = 'Use a folder outside the workspace directory?'
export const OTHER_PROFILE_QUESTION = 'Use a folder of another profile?'
export const TRUST_REFUSED = 'Aether did not start the agent in this repository.'

export const trustQuestion = (page: Page) => page.getByRole('dialog', { name: TRUST_QUESTION, exact: true })
export const outsideQuestion = (page: Page) => page.getByRole('dialog', { name: OUTSIDE_QUESTION, exact: true })
export const otherProfileQuestion = (page: Page) => page.getByRole('dialog', { name: OTHER_PROFILE_QUESTION, exact: true })
export const button = (question: ReturnType<Page['getByRole']>, name: string) => question.getByRole('button', { name, exact: true })
export const trustRefused = (page: Page) => main(page).getByText(TRUST_REFUSED, { exact: true })

/** Checks that no question of S6 shows. */
export async function expectNoQuestion(page: Page, check: string): Promise<void> {
  await expect(trustQuestion(page), `${check}: the trust question shows, but Aether must ask nothing here.`).toHaveCount(0)
  await expect(outsideQuestion(page), `${check}: the directory question for a folder outside the workspace directory shows, but Aether must ask nothing here.`).toHaveCount(0)
  await expect(otherProfileQuestion(page), `${check}: the directory question for a folder of another profile shows, but Aether must ask nothing here.`).toHaveCount(0)
}

// Agent processes.

/**
 * The IDs of the running processes whose command line holds the control pipe of the test: the
 * launcher and the simulated agent. Windows lists them through CIM.
 */
export function agentProcessIds(chat: ChatApp): number[] {
  const id = chat.control.pipeName.slice(-36) // The UUID at the end of the pipe name.
  const script = `Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%${id}%'" | Where-Object { $_.ProcessId -ne $PID } | ForEach-Object { $_.ProcessId }`
  const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true })
  if (run.error || run.status !== 0) throw new Error(`The process list failed: ${run.error?.message ?? run.stderr}`)
  return run.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(Number)
}

/** Checks that no agent process started and that none runs. */
export function expectNoAgentProcess(chat: ChatApp, check: string, when: string): void {
  expect(chat.control.pids, `${check}: an agent process started ${when}.`).toEqual([])
  expect(chat.control.received('session/new'), `${check}: an agent got session/new ${when}.`).toEqual([])
  expect(agentProcessIds(chat), `${check}: an agent process runs ${when}.`).toEqual([])
}
