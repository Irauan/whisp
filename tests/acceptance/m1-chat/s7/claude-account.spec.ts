// The user decisions of 2026-11-27 that story S7 of milestone m1-chat carries.
//
// 1. Decision 0011 is decided as "subscription only". Aether removes the adapter flag
//    `--hide-claude-auth`. The agent process of Claude Code does not get that argument.
// 2. The field "Claude profile name" (`ANTHROPIC_PROFILE`) is removed. A Claude account is only its
//    config folder. "Profile settings" has no field "Claude profile name", and the agent
//    environment has no `ANTHROPIC_PROFILE`.
//
// The flag lives in the launch recipe of Claude Code. An `agents.json` entry replaces the program
// and the arguments of the recipe, so the simulated agent cannot see the arguments of the built-in
// adapter. One test therefore checks the launch of the recipe without an entry, with no app.
// No test sleeps. Each wait is an auto-waiting check of Playwright, or a report of the agent.
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { claudeCodeRecipe } from '../../../../src/providers/claude-code/claude-code'
import {
  DRAFT_IN_REPO_A,
  expect,
  expectInTranscript,
  invoke,
  PROFILE,
  reach,
  startImported,
  startSession,
  test,
  variable,
  writeOldProfile
} from './fixture'

const HIDE_CLAUDE_AUTH = '--hide-claude-auth'

/**
 * The wait of a check that a field is absent. The dialog is visible already, so its fields are
 * there. A shorter wait keeps the four soft checks within the time limit of one test.
 */
const ABSENT_MS = 5_000

/** Opens the dialog of the profile menu: "Profile settings" or "Add profile". */
async function openProfileDialog(page: Page, name: 'Profile settings' | 'Add profile', check: string) {
  await page.getByRole('button', { name: new RegExp(`^${PROFILE}`) }).first().click()
  const menu = page.getByRole('group', { name: 'Profiles' })
  await expect(menu, `${check}: the profile menu "Profiles" does not open.`).toBeVisible()
  await menu.getByRole('button', { name, exact: true }).click()
  const dialog = page.getByRole('dialog', { name })
  await expect(dialog, `${check}: the dialog "${name}" does not open.`).toBeVisible()
  return dialog
}

test.describe('Decision 0011, subscription only: Aether never passes --hide-claude-auth', () => {
  test('Decision 0011: the built-in launch of Claude Code has no argument --hide-claude-auth', async () => {
    const launch = await claudeCodeRecipe().launch({})
    expect(launch.ok, 'Decision 0011: the built-in launch recipe of Claude Code must give a program.').toBe(true)
    if (!launch.ok) return
    expect(launch.value.args, `Decision 0011: the built-in launch of Claude Code still passes ${HIDE_CLAUDE_AUTH}.`).not.toContain(HIDE_CLAUDE_AUTH)
  })

  test('Decision 0011: the agent process of Claude Code gets only the arguments of its agents.json entry, without --hide-claude-auth', async ({
    chat
  }) => {
    const check = 'Decision 0011 agent arguments'
    await chat.control.scenario('text', { chunks: ['Hello ', 'from the agent.'] })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    await startSession(page, 'Say hello', check)
    const start = await reach(chat.control.waitForEnvironment(), `${check}: the session started no agent process.`)
    await expectInTranscript(page, 'Hello from the agent.', `${check}: the session gets no reply.`)
    expect(start.args, `${check}: the agent process got ${HIDE_CLAUDE_AUTH}.`).not.toContain(HIDE_CLAUDE_AUTH)
    // The arguments after the script of the entry: only the pipe name of the test.
    expect(start.args, `${check}: the agent process got arguments that its agents.json entry does not have.`).toEqual([chat.control.pipeName])
  })
})

test.describe('User decision 2026-11-27: a Claude account is only its config folder', () => {
  test('Claude account: "Profile settings" and "Add profile" have the field "Claude folder" and no field "Claude profile name"', async ({ chat }) => {
    const check = 'Claude account dialogs'
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    // Soft checks: a failure in the first dialog still lets the test check the second one.
    for (const name of ['Profile settings', 'Add profile'] as const) {
      const dialog = await openProfileDialog(page, name, check)
      await expect(dialog.getByRole('textbox', { name: 'Claude folder', exact: true }), `${check}: "${name}" has no text field "Claude folder".`).toBeVisible()
      await expect.soft(dialog.getByRole('textbox', { name: 'Claude profile name' }), `${check}: "${name}" still has the field "Claude profile name".`).toHaveCount(0, { timeout: ABSENT_MS })
      await expect.soft(dialog.getByText(/Claude profile name/i), `${check}: "${name}" still shows the words "Claude profile name".`).toHaveCount(0, { timeout: ABSENT_MS })
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(dialog, `${check}: the dialog "${name}" stays open after "Cancel".`).toBeHidden()
    }
  })

  test('Claude account: the agent environment has no ANTHROPIC_PROFILE, also when Aether has one and a profile name is sent', async ({ chat }) => {
    const check = 'Claude account environment'
    const claudeFolder = join(chat.root, 'claude-one')
    await chat.control.scenario('text', { chunks: ['Hello ', 'from the agent.'] })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat, { ANTHROPIC_PROFILE: 'fake-profile-of-aether' })

    // The contract of "Profile settings", with a Claude profile name as the old field sent it. A
    // version without the field refuses or drops it. The result does not count, only the agent environment.
    const profiles = await invoke(page, 'profiles.list', {})
    if (!profiles.ok) throw new Error(`profiles.list failed: ${profiles.error.message}`)
    const profile = (profiles.value.profiles as Record<string, unknown>[]).find((item) => item.name === PROFILE)!
    await invoke(page, 'profiles.edit', {
      id: profile.id,
      name: profile.name,
      workspaceDirectory: profile.workspaceDirectory,
      github: profile.github,
      claudeFolder,
      claudeProfileName: 'work'
    })

    await startSession(page, 'Say hello', check)
    const start = await reach(chat.control.waitForEnvironment(), `${check}: the session started no agent process.`)
    await expectInTranscript(page, 'Hello from the agent.', `${check}: the session gets no reply.`)
    expect(variable(start.env, 'ANTHROPIC_PROFILE') === undefined, `${check}: the agent environment has ANTHROPIC_PROFILE.`).toBe(true)
  })
})
