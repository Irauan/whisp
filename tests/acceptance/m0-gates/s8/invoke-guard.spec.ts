// G19 of milestone m0-gates, on the built app.
//
// G19: the renderer calls `invoke` with an unknown name, with invalid input, or from another
// frame. The main process returns an error and runs no handler.
//
// How a test sees that no handler ran: the only handler that these calls could reach is the
// GitHub accounts query, and it runs the fake `gh`. The fake `gh` writes one file per call, so
// the count of its calls must stay the same. The first test proves that this probe works.
import { LIST_GITHUB_ACCOUNTS, expect, isError, test, type GithubApp, type Outcome } from './fixture'

/** Names that are not in the registry. `github:accounts` is the old channel of the same query. */
const UNKNOWN_NAMES = ['workspaces.no-such-query', 'github:accounts', 'constructor']

/** Inputs that the contract `{}` rejects. */
const INVALID_INPUTS: unknown[] = [null, 'not an object', 42]

const describe = (outcome: Outcome) =>
  outcome.settled === 'rejected' ? `rejected: ${outcome.message}` : `resolved: ${JSON.stringify(outcome.value)}`

/** Runs a call and checks that it returns an error and that the fake `gh` did not run. */
async function expectRefused(github: GithubApp, call: () => Promise<Outcome>, what: string): Promise<void> {
  const before = (await github.gh.calls()).length
  const outcome = await call()
  expect(isError(outcome), `${what} must return an error, but it ${describe(outcome)}`).toBe(true)
  expect(await github.gh.calls(), `${what} ran a handler: the fake gh ran`).toHaveLength(before)
}

test.describe('G19: invoke refuses unknown names, invalid input and other frames', () => {
  test('G19: a valid call from the app window runs the handler, so the probe works', async ({ github }) => {
    const outcome = await github.invoke(LIST_GITHUB_ACCOUNTS, {})
    expect(isError(outcome), `The valid call must succeed, but it ${describe(outcome)}`).toBe(false)
    expect(await github.gh.calls()).not.toHaveLength(0)
  })

  test('G19: invoke with an unknown name returns an error and runs no handler', async ({ github }) => {
    // A valid call first: the app is ready, and the probe counts from a known state.
    expect(isError(await github.invoke(LIST_GITHUB_ACCOUNTS, {}))).toBe(false)
    for (const name of UNKNOWN_NAMES) {
      await expectRefused(github, () => github.invoke(name, {}), `invoke('${name}', {})`)
    }
  })

  test('G19: invoke with invalid input returns an error and runs no handler', async ({ github }) => {
    expect(isError(await github.invoke(LIST_GITHUB_ACCOUNTS, {}))).toBe(false)
    for (const input of INVALID_INPUTS) {
      await expectRefused(
        github,
        () => github.invoke(LIST_GITHUB_ACCOUNTS, input),
        `invoke('${LIST_GITHUB_ACCOUNTS}', ${JSON.stringify(input)})`
      )
    }
  })

  test('G19: invoke from another frame returns an error and runs no handler', async ({ github }) => {
    expect(isError(await github.invoke(LIST_GITHUB_ACCOUNTS, {}))).toBe(false)
    await expectRefused(
      github,
      () => github.invokeFromOtherFrame(LIST_GITHUB_ACCOUNTS, {}),
      `invoke('${LIST_GITHUB_ACCOUNTS}', {}) from another frame`
    )
  })
})
