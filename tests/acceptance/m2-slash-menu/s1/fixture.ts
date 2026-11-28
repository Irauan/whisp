// The fixture of the S1 tests of milestone m2-slash-menu: the slash menu in a running session.
// Brief: `docs/milestones/m2-slash-menu/brief.md`, checks B1 to B8. Spec:
// `docs/milestones/m2-slash-menu/stories/s1-slash-menu.md` and its mockup `s1-slash-menu.mockup.html`
// (approved by the user on 2026-11-28).
//
// The setup is the chat fixture of m1-chat S4 (`../../m1-chat/s4/fixture.ts`): the built app in a
// temporary data folder, a temporary APPDATA and home, the fake `gh`, the simulated agent as Claude
// Code in `agents.json`, and the check that the real data folder (`%APPDATA%\aether`) does not change.
// The profiles and their drafts come from an old `workspace.json`, in plain folders, so Aether asks
// no trust question. All data is fake: no real skill name and no account data.
//
// The agent. The scenario `commands` of the simulated agent (added for this story) sends the list
// of the session (`available_commands_update`) right after the response to `session/new`, with no
// prompt and no timer, as the Claude adapter 0.112 does. A gate can hold the list (B7), and a gate
// can send a later change (B6). With `skills`, the list comes from the skill folders of the Claude
// folder of the process (B8). The scenario `steps` takes `afterSession` for a sequence that no other
// test shares.
//
// "A running session" (B1): S1 adds the menu to the reply composer of the session window, after the
// first message (spec rule 24). Each test starts a session from the "New session" page with a first
// message, waits for the reply and the end of the turn, and then types in the reply composer.
// S2 starts the agent when a session opens; these tests do not depend on that.
//
// No test sleeps. A test waits on an auto-waiting check of Playwright, or on a report of the
// simulated agent through `reach`. A check that something does not happen first proves that the
// menu works in the same window (a positive anchor), so it cannot pass while the menu is missing.
// Each test types with real keys (`pressSequentially` and `keyboard.press`), never with `fill`,
// because the menu follows the text before the caret.
//
// The UI that these tests expect (S1 test contract). The m1-chat contracts stay.
// - Composer: the reply composer of the session window keeps the role `textbox` and the name
//   "Prompt" (spec, "Interfaces", ComposerEditor; check S1-12). Its text is read as the value of a
//   text area, or as the rendered text of an editor with inline tokens, so the tests work for both.
// - Menu: an element with the role `listbox`, named exactly "Commands". Each row is an element with
//   the role `option` in it, with `aria-selected` "true" for the selected row only (spec, "Screens").
// - A row shows the name with its `/` (for example "/review") in an element of its own, in bold
//   (font weight 600 or more), then the hint when the command has one (for example "[pr]"), then
//   the description in muted text (a color other than the color of the name). The tests read the
//   text of the row in this order.
// - The menu sits above the composer: its bottom edge is at or above the top edge of "Prompt", and it
//   is at least as wide as "Prompt" (the full width of the box).
// - At most 9 rows show: at most 9 rows lie fully inside the visible area of the menu. The menu is at
//   most 300 px high, and it scrolls.
// - State texts in the main region, as the spec writes them: "Loading commands…" (with the character
//   U+2026), "No command matches /<text>.".
// - Command tag (the spec gives it no role): an element in "Prompt" whose whole text is the command
//   name without its `/` (for example "compact"), and that holds an icon (an `svg` element). The same
//   element shows in the user entry of the transcript (the log "Transcript"). No text "/compact"
//   shows for a picked command: the tag replaces it.
// - The placeholder of a tag with a hint: the hint (for example "[pr]") shows as text in the main
//   region while the text after the tag is empty, and the menu is closed.
// - The agent gets the message as plain text: the text blocks of `session/prompt`, joined.
// - The saved `user` entry (table `entries`, JSON in `data`) holds `text` "/<name> <rest>" and the
//   optional field `command` with the command name (spec, "Data").
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { answerDirectoryDialog } from '../../m1-chat/s2/fixture'
import {
  DRAFT_IN_REPO_A,
  expect,
  expectInTranscript,
  openNewSession,
  promptField,
  reach,
  sessionEntry,
  startImported,
  startSession,
  stopButton,
  writeOldProfile,
  type ChatApp
} from '../../m1-chat/s4/fixture'
import type { AcpMessage } from '../../../simulated-agent/control'

export { expect, main, promptField, reach, sendButton, sessionEntry, stopButton, test, transcript, type ChatApp } from '../../m1-chat/s4/fixture'

/** One command as the ACP agent sends it in `available_commands_update`. */
export interface AcpCommand {
  name: string
  description: string
  input: { hint: string } | null
}

/** The list of B1: four commands in the agent order, each with a description. Fake data. */
export const B1_COMMANDS: AcpCommand[] = [
  { name: 'review', description: 'Review a pull request and report the problems.', input: { hint: '[pr]' } },
  { name: 'compact', description: 'Keep a summary of the conversation and clear the rest.', input: null },
  { name: 'mcp:github:pr', description: 'Summarize a pull request of the fake GitHub server.', input: null },
  { name: 'mcp', description: 'Show the MCP servers and their status.', input: { hint: '[reconnect|enable|disable]' } }
]

/** The `afterSession` step that sends a command list, for the scenario `steps`. */
export const listStep = (commands: AcpCommand[]) =>
  ({ do: 'update', update: { sessionUpdate: 'available_commands_update', availableCommands: commands } }) as const

/** The reply of the agent to the first message. */
export const REPLY = 'Hello from the agent.'
export const REPLY_CHUNKS = ['Hello ', 'from the agent.']

/** The first message of each running session. */
export const FIRST_MESSAGE = 'Say hello'

const escaped = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The menu and the composer.

export const commandMenu = (page: Page) => page.getByRole('listbox', { name: 'Commands', exact: true })
export const menuRows = (page: Page) => commandMenu(page).getByRole('option')
/** The name of a row: the element whose whole text is the name with its `/`. */
export const rowName = (row: Locator, name: string) => row.getByText(`/${name}`, { exact: true })
/** The row of a command: the row that holds the name element of the command. */
export const menuRow = (page: Page, name: string) => menuRows(page).filter({ has: page.getByText(`/${name}`, { exact: true }) })
export const selectedRows = (page: Page) => commandMenu(page).locator('[role="option"][aria-selected="true"]')

export const LOADING = 'Loading commands…'
export const noMatch = (text: string) => `No command matches /${text}.`

/** The command tag of `name` in a scope: an element whose whole text is the name, with an icon in it. */
export const commandTag = (scope: Locator, name: string) =>
  scope.locator('*', { has: scope.page().locator('svg'), hasText: new RegExp(`^\\s*${escaped(name)}\\s*$`) })

/** The text of the composer: the value of a text area, or the rendered text of an editor, with plain spaces. */
export async function composerText(field: Locator): Promise<string> {
  const text = await field.evaluate((element) => {
    const node = element as unknown as { tagName: string; value?: string; innerText: string }
    return node.tagName === 'TEXTAREA' || node.tagName === 'INPUT' ? (node.value ?? '') : node.innerText
  })
  // An editor can end its rendered text with a line break. It is not part of the text.
  return text.replaceAll(/[​﻿]/g, '').replaceAll(' ', ' ').replace(/[\r\n]+$/, '')
}

/** Checks the text of the composer, with an auto-waiting poll. */
export async function expectComposerText(page: Page, expected: string | RegExp, message: string): Promise<void> {
  const poll = expect.poll(() => composerText(promptField(page)), { message })
  if (typeof expected === 'string') await poll.toBe(expected)
  else await poll.toMatch(expected)
}

/** Types into the reply composer with real keys. The caret goes to the end of the text first. */
export async function typeInComposer(page: Page, text: string, check: string): Promise<void> {
  const field = promptField(page)
  await expect(field, `${check}: the session window has no text field "Prompt".`).toBeEditable()
  await field.focus()
  await page.keyboard.press('End')
  await field.pressSequentially(text)
}

/** Empties the reply composer with the keys Control+A and Backspace. */
export async function clearComposer(page: Page, check: string): Promise<void> {
  await promptField(page).focus()
  await page.keyboard.press('Control+A')
  await page.keyboard.press('Backspace')
  await expectComposerText(page, /^\s*$/, `${check}: Control+A and Backspace do not empty "Prompt".`)
}

/** Types `text` (it starts with `/`) and checks that the menu "Commands" opens. */
export async function openMenu(page: Page, check: string, text = '/'): Promise<void> {
  await typeInComposer(page, text, check)
  await expect(commandMenu(page), `${check}: typing "${text}" at the start of "Prompt" opens no listbox "Commands".`).toBeVisible()
}

/** Checks the names of the rows of the menu, in the order of the screen. */
export async function expectRows(page: Page, names: string[], check: string): Promise<void> {
  await expect(menuRows(page), `${check}: the menu "Commands" must show ${names.length} row(s): ${names.map((name) => `/${name}`).join(', ')}.`).toHaveCount(
    names.length
  )
  for (const [index, name] of names.entries()) {
    await expect(rowName(menuRows(page).nth(index), name), `${check}: row ${index + 1} of the menu must be "/${name}".`).toBeVisible()
  }
}

/** Checks that exactly one row is selected, and that it is the row of `name`. */
export async function expectSelected(page: Page, name: string, check: string): Promise<void> {
  await expect(selectedRows(page), `${check}: exactly one row of the menu must have aria-selected="true".`).toHaveCount(1)
  await expect(rowName(selectedRows(page), name), `${check}: the selected row must be "/${name}".`).toBeVisible()
}

/**
 * The positions (from 0) of the rows that lie fully inside the visible area of the menu (its nearest
 * scroll area), the position of the selected row, if that area scrolls, and the height of the menu.
 */
export async function visibleRows(page: Page): Promise<{ visible: number[]; selected: number; scrolls: boolean; height: number }> {
  return commandMenu(page).evaluate((menu) => {
    interface Box {
      top: number
      bottom: number
      height: number
    }
    interface Item {
      parentElement: Item | null
      scrollHeight: number
      clientHeight: number
      getAttribute(name: string): string | null
      getBoundingClientRect(): Box
      querySelectorAll(selector: string): ArrayLike<Item>
    }
    const win = globalThis as unknown as { getComputedStyle(item: Item): { overflowY: string } }
    const root = menu as unknown as Item
    const rows = Array.from(root.querySelectorAll('[role="option"]'))
    // The scroll area: the menu or the nearest element around the rows that can scroll.
    let area: Item | null = rows[0]?.parentElement ?? root
    while (area && !/(auto|scroll)/.test(win.getComputedStyle(area).overflowY)) {
      if (area === root) {
        area = null
        break
      }
      area = area.parentElement
    }
    const scrollArea = area ?? root
    const view = scrollArea.getBoundingClientRect()
    const visible = rows
      .map((row, index) => ({ box: row.getBoundingClientRect(), index }))
      .filter(({ box }) => box.height > 0 && box.top >= view.top - 0.5 && box.bottom <= view.bottom + 0.5)
      .map(({ index }) => index)
    return {
      visible,
      selected: rows.findIndex((row) => row.getAttribute('aria-selected') === 'true'),
      scrolls: scrollArea.scrollHeight > scrollArea.clientHeight + 1,
      height: root.getBoundingClientRect().height
    }
  })
}

// The session.

/** Writes the profile "Personal" with one draft in `repo-a`, starts Aether, and answers the import dialog. */
export async function startAether(chat: ChatApp): Promise<Page> {
  await writeOldProfile(chat, [DRAFT_IN_REPO_A])
  return startImported(chat)
}

/**
 * Starts a session from the "New session" page with the first message, and waits for the reply and
 * the end of the turn. The session then runs: its agent process is ready. Takes the report of the
 * first `session/prompt`, so a later wait gets the next one.
 */
export async function startRunningSession(chat: ChatApp, page: Page, check: string, message = FIRST_MESSAGE): Promise<void> {
  await startSession(page, message, check)
  await reach(chat.control.waitForMessage('session/prompt'), `${check}: the agent did not get the first message.`)
  await expectInTranscript(page, REPLY, `${check}: the reply to the first message does not show.`)
  await expect(stopButton(page), `${check}: the first turn does not end.`).toHaveCount(0)
  // The mouse stays where "Start session" was. A menu that opens under it would get a hover that
  // the test did not make, so the mouse goes to the top left corner of the window.
  await page.mouse.move(0, 0)
}

/** The text of a `session/prompt` request: its text blocks, joined. */
export function promptText(message: AcpMessage): string {
  const blocks = (message.params as { prompt?: { type?: string; text?: string }[] } | undefined)?.prompt ?? []
  return blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
}

/** Waits for the next `session/prompt` and returns its text. */
export async function nextPromptText(chat: ChatApp, check: string): Promise<string> {
  return promptText(await reach(chat.control.waitForMessage('session/prompt'), `${check}: the agent did not get the message.`))
}

/** The saved `user` entries, in the order of the conversation: the JSON of each row. */
export function userEntries(data: { rowsOf(table: string): { values: Record<string, unknown> }[] }): Record<string, unknown>[] {
  return data
    .rowsOf('entries')
    .filter((row) => row.values.kind === 'user')
    .sort((a, b) => Number(a.values.position) - Number(b.values.position))
    .map((row) => JSON.parse(String(row.values.data)) as Record<string, unknown>)
}

/** Quits and starts Aether, and opens the session with this title. */
export async function restartAndOpen(chat: ChatApp, title: string, check: string): Promise<Page> {
  await chat.stop()
  const page = await chat.start()
  const entry = sessionEntry(page, title)
  await expect(entry, `${check}: after a restart, the sidebar does not list the session "${title}".`).toBeVisible()
  await entry.click()
  await expect(entry, `${check}: after a restart, the session "${title}" does not open.`).toHaveAttribute('aria-current', 'page')
  return page
}

// Two profiles (B8).

export const PROFILES = { personal: 'Personal', client: 'Client Example' } as const
export type Profile = keyof typeof PROFILES

/** The workspace directory of a profile. The one of "Personal" is the folder of the S4 fixture. */
export const directoryOf = (chat: ChatApp, profile: Profile) => (profile === 'personal' ? chat.directory : join(chat.root, 'directories', 'client'))

/** The plain folder of the draft of each profile. */
export const draftFolderOf = (chat: ChatApp, profile: Profile) => join(directoryOf(chat, profile), 'notes')

/** The Claude folder of each profile, outside both workspace directories. */
export const claudeFolderOf = (chat: ChatApp, profile: Profile) => join(chat.root, 'claude', profile)

/** Creates a fake skill in a Claude folder: `skills/<name>/SKILL.md` with a description. */
export async function addSkill(claudeFolder: string, name: string, description: string): Promise<void> {
  await mkdir(join(claudeFolder, 'skills', name), { recursive: true })
  await writeFile(join(claudeFolder, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nA fake skill for a test.\n`)
}

/**
 * Writes the old `workspace.json` of version 4 with both profiles and one draft in each, in a plain
 * folder. The new session of a profile then starts in the folder of its draft. Starts Aether and
 * answers the import dialog.
 */
export async function startWithProfiles(chat: ChatApp): Promise<Page> {
  const profiles = Object.keys(PROFILES) as Profile[]
  for (const profile of profiles) await mkdir(draftFolderOf(chat, profile), { recursive: true })
  const file = {
    version: 4,
    accounts: profiles.map((profile) => ({ id: profile, label: PROFILES[profile], github: null })),
    currentAccountId: 'personal',
    projects: [],
    workItems: [],
    sessions: profiles.map((profile, index) => ({
      id: `session-${index + 1}`,
      accountId: profile,
      title: `Draft of ${PROFILES[profile]}`,
      prompt: `Draft of ${PROFILES[profile]}`,
      settings: { folder: draftFolderOf(chat, profile), mode: 'interactive', permissions: 'ask', model: 'default', checkout: 'folder', attachments: [] },
      createdAt: `2026-01-0${index + 1}T00:00:00.000Z`
    }))
  }
  await writeFile(join(chat.dataDir, 'workspace.json'), JSON.stringify(file, null, 2))
  const page = await chat.start()
  await answerDirectoryDialog(page, { [PROFILES.personal]: directoryOf(chat, 'personal'), [PROFILES.client]: directoryOf(chat, 'client') })
  return page
}

/** The profile menu: the first button whose name starts with the name of the current profile (m1-chat S2 contract). */
const profileButton = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^${escaped(name)}`) }).first()

/** Switches the current profile with the profile menu. */
export async function switchProfile(page: Page, from: Profile, to: Profile, check: string): Promise<void> {
  await profileButton(page, PROFILES[from]).click()
  const menu = page.getByRole('group', { name: 'Profiles' })
  await expect(menu, `${check}: the profile menu "Profiles" does not open.`).toBeVisible()
  await menu.getByRole('button', { name: PROFILES[to], exact: true }).click()
  await expect(profileButton(page, PROFILES[to]), `${check}: the profile "${PROFILES[to]}" does not become current.`).toBeVisible()
}

/** Sets the Claude folder of the current profile in "Profile settings" (m1-chat S4 contract). */
export async function setClaudeFolder(page: Page, profile: Profile, folder: string, check: string): Promise<void> {
  await profileButton(page, PROFILES[profile]).click()
  const menu = page.getByRole('group', { name: 'Profiles' })
  await expect(menu, `${check}: the profile menu "Profiles" does not open.`).toBeVisible()
  await menu.getByRole('button', { name: 'Profile settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Profile settings' })
  await expect(dialog, `${check}: the dialog "Profile settings" does not open.`).toBeVisible()
  const field = dialog.getByRole('textbox', { name: 'Claude folder', exact: true })
  await expect(field, `${check}: the dialog "Profile settings" has no text field "Claude folder".`).toBeEditable()
  await field.fill(folder)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog, `${check}: the dialog "Profile settings" stays open after "Save".`).toBeHidden()
}

export { openNewSession }
