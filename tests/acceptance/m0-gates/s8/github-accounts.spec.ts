// G18 of milestone m0-gates, on the built app.
//
// G18: the renderer calls `invoke('profiles.list-github-accounts', {})`. A fake `gh` reports two
// accounts. The account dialog lists both.
// The brief names the contract `github.list-accounts`. The plan names it
// `workspaces.list-github-accounts`, and the coordinator chose the plan name. User decision,
// 2026-11-26: "Profile" everywhere, so the name is now `profiles.list-github-accounts`.
//
// From m1-chat S2, accounts are profiles (decision 0004, and the user decision of 2026-11-26).
// The account dialog is now the dialog "Add profile", in the profile menu "Profiles". The first
// start with old files shows the import dialog "Choose workspace directories" first. The first
// test answers it, because a modal dialog blocks the clicks. The UI names come from the S2 tests.
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ACCOUNTS, LIST_GITHUB_ACCOUNTS, expect, test } from './fixture'

test.describe('G18: the GitHub accounts query through the contract', () => {
  test('G18: the profile dialog lists the two accounts of the fake gh, through invoke', async ({ github }) => {
    const { page } = github

    // The import dialog of m1-chat S2: the workspace directory of the one imported profile.
    const directory = join(github.root, 'workspace-directory')
    await mkdir(directory, { recursive: true })
    const directories = page.getByRole('dialog', { name: 'Choose workspace directories' })
    await expect(directories).toBeVisible()
    await directories.getByRole('textbox', { name: 'Workspace directory of Personal', exact: true }).fill(directory)
    await directories.getByRole('button', { name: 'Save directories', exact: true }).click()
    await expect(directories).toBeHidden()

    // Open the profile dialog: the profile menu, then "Add profile".
    await page.getByRole('button', { name: /Personal/ }).first().click()
    await page.getByRole('group', { name: 'Profiles' }).getByRole('button', { name: 'Add profile' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add profile' })
    await expect(dialog).toBeVisible()

    // The dialog lists both accounts of the fake gh.
    for (const { login } of ACCOUNTS) {
      await expect(dialog.getByText(`@${login}`, { exact: true })).toBeVisible()
    }

    // The dialog read them through the new contract, not through the old channel.
    const calls = await github.invokes()
    expect(
      calls.filter((call) => call.includes(JSON.stringify(LIST_GITHUB_ACCOUNTS))),
      `The profile dialog did not call invoke('${LIST_GITHUB_ACCOUNTS}', {}). Calls that reached the main process: ${calls.join(', ')}`
    ).not.toHaveLength(0)
  })

  test('G18: invoke of the contract from the renderer returns the two accounts of the fake gh', async ({
    github
  }) => {
    const outcome = await github.invoke(LIST_GITHUB_ACCOUNTS, {})

    expect(outcome.settled, `invoke rejected: ${outcome.settled === 'rejected' ? outcome.message : ''}`).toBe(
      'resolved'
    )
    const value = outcome.settled === 'resolved' ? outcome.value : null
    // The slice returns a `Result`. A success has `ok: true`.
    expect(value).toMatchObject({ ok: true })
    const text = JSON.stringify(value)
    for (const { login } of ACCOUNTS) expect(text).toContain(JSON.stringify(login))

    // The handler read the accounts from the fake gh.
    expect(await github.gh.calls()).not.toHaveLength(0)
  })
})
