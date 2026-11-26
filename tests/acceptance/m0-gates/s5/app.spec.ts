// G11 and G12 of milestone m0-gates, on the built app.
//
// The app runs in a temporary data folder with the simulated agent in `agents.json`.
// No test sleeps. Each wait is an auto-waiting check of Playwright, or a report that the
// simulated agent sends on its control pipe.
import { readdir, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { expect, ITEM_ID, ITEM_TITLE, realDataDir, test, type AetherApp } from './fixture'

/** Opens the work item, chooses the simulated agent, and sends "hello" in the work item panel. */
async function sendHello({ page }: AetherApp): Promise<void> {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: ITEM_TITLE }).click()
  await expect(page.getByRole('heading', { level: 1, name: ITEM_TITLE })).toBeVisible()
  // Claude Code is the first agent of the picker. The test chooses the simulated one.
  await page.getByRole('combobox', { name: 'Agent' }).selectOption({ label: 'Simulated' })
  await page.getByRole('textbox', { name: 'Message to the agent' }).fill('hello')
  await page.getByRole('button', { name: 'Send' }).click()
}

/** The agent reply. The exact match leaves out the message of the user, which is "hello". */
const reply = ({ page }: AetherApp) => page.getByText('Hello', { exact: true })
const working = ({ page }: AetherApp) => page.getByText('Working', { exact: true })

/** Lists the files and folders of the user data that the product writes, with their times. */
async function snapshot(folder: string): Promise<string[]> {
  const found: string[] = []
  const visit = async (path: string): Promise<void> => {
    let info
    try {
      info = await stat(path)
    } catch {
      return // Missing: the snapshot records nothing for it.
    }
    found.push(`${relative(folder, path)}|${info.isDirectory() ? 'dir' : info.size}|${info.mtimeMs}`)
    if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await visit(join(path, name))
    }
  }
  // The files that Aether writes. Chromium caches and logs are not part of the check.
  for (const name of ['agents.json', 'workspace.json', 'runs']) await visit(join(folder, name))
  return found
}

const samePath = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase()

test.describe('the built app with the simulated agent', () => {
  test('G11: "hello" in the work item panel shows "Hello", in a temporary data folder', async ({ aether }) => {
    const realBefore = await snapshot(realDataDir())

    await aether.control.scenario('text')
    await sendHello(aether)
    await expect(reply(aether)).toBeVisible()

    // The simulated agent got the text through ACP.
    expect(aether.control.received('session/prompt')[0]?.params).toMatchObject({
      prompt: [{ type: 'text', text: 'hello' }]
    })

    // The app ran in the temporary folder, not in the real one.
    const userData = await aether.app.evaluate(({ app }) => app.getPath('userData'))
    expect(samePath(userData, aether.dataDir)).toBe(true)
    expect(samePath(userData, realDataDir())).toBe(false)
    // The conversation of the work item reached the temporary folder.
    await expect
      .poll(async () => (await snapshot(aether.dataDir)).some((line) => line.startsWith(join('runs', `${ITEM_ID}.json`))))
      .toBe(true)

    // The real folder has the same files, with the same times, as before.
    expect(await snapshot(realDataDir())).toEqual(realBefore)
  })

  test('G12: the app shows "Working" while the agent waits at a gate, and the reply after it opens', async ({
    aether
  }) => {
    await aether.control.scenario('text', { gate: 'reply' })
    await sendHello(aether)

    // The agent reported the gate before it waited, so it cannot have replied yet.
    await aether.control.waitForGate('reply')
    await expect(working(aether)).toBeVisible()
    await expect(reply(aether)).toHaveCount(0)

    await aether.control.open('reply')
    await expect(reply(aether)).toBeVisible()
    await expect(working(aether)).toBeHidden()
  })
})
