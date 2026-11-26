// G18 of milestone m0-gates, on the built app.
//
// G18: the renderer calls `invoke('workspaces.list-github-accounts', {})`. A fake `gh` reports two
// accounts. The account dialog lists both.
// The brief names the contract `github.list-accounts`. The plan names it
// `workspaces.list-github-accounts`, and the coordinator chose the plan name.
//
// From m1-chat S2, accounts are workspaces (decision 0004). The account dialog is now the
// dialog "Add workspace", in the workspace menu "Workspaces". The first start with an old
// profile shows the import dialog "Choose workspace roots" first. The first test answers it,
// because a modal dialog blocks the clicks. The UI names come from the S2 tests.
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ACCOUNTS, LIST_GITHUB_ACCOUNTS, expect, test } from './fixture'

test.describe('G18: the GitHub accounts query through the contract', () => {
  test('G18: the workspace dialog lists the two accounts of the fake gh, through invoke', async ({ github }) => {
    const { page } = github

    // The import dialog of m1-chat S2: the root of the one imported workspace.
    const root = join(github.root, 'workspace-root')
    await mkdir(root, { recursive: true })
    const roots = page.getByRole('dialog', { name: 'Choose workspace roots' })
    await expect(roots).toBeVisible()
    await roots.getByRole('textbox', { name: 'Root of Personal', exact: true }).fill(root)
    await roots.getByRole('button', { name: 'Save roots', exact: true }).click()
    await expect(roots).toBeHidden()

    // Open the workspace dialog: the workspace menu, then "Add workspace".
    await page.getByRole('button', { name: /Personal/ }).first().click()
    await page.getByRole('group', { name: 'Workspaces' }).getByRole('button', { name: 'Add workspace' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add workspace' })
    await expect(dialog).toBeVisible()

    // The dialog lists both accounts of the fake gh.
    for (const { login } of ACCOUNTS) {
      await expect(dialog.getByText(`@${login}`, { exact: true })).toBeVisible()
    }

    // The dialog read them through the new contract, not through the old channel.
    const calls = await github.invokes()
    expect(
      calls.filter((call) => call.includes(JSON.stringify(LIST_GITHUB_ACCOUNTS))),
      `The workspace dialog did not call invoke('${LIST_GITHUB_ACCOUNTS}', {}). Calls that reached the main process: ${calls.join(', ')}`
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
