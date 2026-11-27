// A18 of milestone m1-chat, on the built app.
//
// A18: an unreadable `workspace.json`, or an unreadable database. When Aether starts, it keeps
// the file aside, shows a message, and never overwrites it.
//
// "Aside" can be a new name or the same place. The tests do not fix the name. They check that a
// file of the data folder still holds the original bytes, after the first start and after a
// second start. A new database at the original path is allowed only when a copy keeps the
// original bytes. Aether never writes `workspace.json`, so its path holds the original bytes or
// nothing.
// No test sleeps. Each wait is an auto-waiting check of Playwright.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DATABASE, expect, filesWithContent, test, type AetherApp } from './fixture'

/** Truncated JSON with CRLF: no version of Aether can read it. */
const UNREADABLE_WORKSPACE = Buffer.from('{"version":4,"accounts":[{"id":"personal","label":"Personal"\r\n')

/** Text, not SQLite: the header of a SQLite file is "SQLite format 3". */
const UNREADABLE_DATABASE = Buffer.from('This is not a SQLite database. It is a fake file of a test.\r\n'.repeat(64))

/** Checks that the original bytes survive in the data folder, and that the original path holds no other bytes. */
async function expectKept(aether: AetherApp, name: string, content: Buffer, when: string): Promise<void> {
  const holders = await filesWithContent(aether.dataDir, content)
  expect(holders, `A18: after ${when}, no file of the data folder holds the original bytes of ${name}.`).not.toHaveLength(0)
  const current = await readFile(join(aether.dataDir, name)).catch(() => null)
  if (current !== null && !current.equals(content)) {
    // A new file at the original path is allowed only when the original bytes are kept elsewhere.
    expect(
      holders.filter((holder) => holder !== name),
      `A18: after ${when}, ${name} holds other bytes and no other file keeps the original.`
    ).not.toHaveLength(0)
  }
}

test.describe('A18: Aether keeps an unreadable file aside, shows a message, and never overwrites it', () => {
  test('A18: an unreadable workspace.json is kept aside, a message shows, and Aether never overwrites it', async ({
    aether
  }) => {
    await writeFile(join(aether.dataDir, 'workspace.json'), UNREADABLE_WORKSPACE)

    const page = await aether.start()
    await expect(
      page.getByRole('alert').filter({ hasText: /could not read workspace\.json/i }),
      'A18: no message says that Aether could not read workspace.json.'
    ).toBeVisible()
    await aether.stop()
    await expectKept(aether, 'workspace.json', UNREADABLE_WORKSPACE, 'the first start')

    // A second start does not overwrite the kept file either. Aether starts.
    const again = await aether.start()
    await expect(again.getByRole('navigation', { name: 'Main' }), 'A18: Aether does not start the second time.').toBeVisible()
    await aether.stop()
    await expectKept(aether, 'workspace.json', UNREADABLE_WORKSPACE, 'the second start')
    // The original path never holds other bytes: Aether does not write workspace.json.
    const current = await readFile(join(aether.dataDir, 'workspace.json')).catch(() => null)
    if (current !== null) expect(current.equals(UNREADABLE_WORKSPACE), 'A18: Aether wrote workspace.json.').toBe(true)
  })

  test('A18: an unreadable database is kept aside, a message shows, and Aether never overwrites it', async ({
    aether
  }) => {
    await writeFile(join(aether.dataDir, DATABASE), UNREADABLE_DATABASE)

    const page = await aether.start()
    await expect(
      page.getByRole('alert').filter({ hasText: /could not read its database/i }),
      'A18: no message says that Aether could not read its database.'
    ).toBeVisible()
    await aether.stop()
    await expectKept(aether, DATABASE, UNREADABLE_DATABASE, 'the first start')

    // A second start does not overwrite the kept file either. Aether starts.
    const again = await aether.start()
    await expect(again.getByRole('navigation', { name: 'Main' }), 'A18: Aether does not start the second time.').toBeVisible()
    await aether.stop()
    await expectKept(aether, DATABASE, UNREADABLE_DATABASE, 'the second start')
  })
})
