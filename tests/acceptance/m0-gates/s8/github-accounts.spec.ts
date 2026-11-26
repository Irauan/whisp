// G18 of milestone m0-gates, on the built app.
//
// G18: the renderer calls `invoke('workspaces.list-github-accounts', {})`. A fake `gh` reports two
// accounts. The account dialog lists both.
// The brief names the contract `github.list-accounts`. The plan names it
// `workspaces.list-github-accounts`, and the coordinator chose the plan name.
import { ACCOUNTS, LIST_GITHUB_ACCOUNTS, expect, test } from './fixture'

test.describe('G18: the GitHub accounts query through the contract', () => {
  test('G18: the account dialog lists the two accounts of the fake gh, through invoke', async ({ github }) => {
    const { page } = github

    // Open the account dialog: the account menu, then "Add account".
    await page.getByRole('button', { name: /Personal/ }).first().click()
    await page.getByRole('group', { name: 'Accounts' }).getByRole('button', { name: 'Add account' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add account' })
    await expect(dialog).toBeVisible()

    // The dialog lists both accounts of the fake gh.
    for (const { login } of ACCOUNTS) {
      await expect(dialog.getByText(`@${login}`, { exact: true })).toBeVisible()
    }

    // The dialog read them through the new contract, not through the old channel.
    const calls = await github.invokes()
    expect(
      calls.filter((call) => call.includes(JSON.stringify(LIST_GITHUB_ACCOUNTS))),
      `The account dialog did not call invoke('${LIST_GITHUB_ACCOUNTS}', {}). Calls that reached the main process: ${calls.join(', ')}`
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
