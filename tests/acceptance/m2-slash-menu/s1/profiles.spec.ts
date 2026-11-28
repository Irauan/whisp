// The slash menu lists the commands of the profile, story S1 of milestone m2-slash-menu, on the built app.
//
// B8: profile A and profile B have different Claude folders. The simulated agent lists `skill-a`
//     under A and `skill-b` under B. The user opens the menu in a session of each profile. A shows
//     only `skill-a`. B shows only `skill-b`.
//
// The agent is the only source of the list (brief, approach). The simulated agent reads the skill
// folders of the Claude folder that Aether gives its process (`CLAUDE_CONFIG_DIR`), as Claude Code
// does (scenario `commands` with `skills`). Aether reads no file of the Claude folder. The skill
// names are fake. `fixture.ts` describes the UI contract. No test sleeps.
import {
  addSkill,
  claudeFolderOf,
  expect,
  expectRows,
  openMenu,
  openNewSession,
  PROFILES,
  REPLY_CHUNKS,
  setClaudeFolder,
  startRunningSession,
  startWithProfiles,
  switchProfile,
  test,
  type ChatApp,
  type Profile
} from './fixture'

/** The Claude folder that the newest agent process got, as Windows reads the name of the variable. */
function lastClaudeFolder(chat: ChatApp): string | undefined {
  const env = chat.control.environments.at(-1)?.env ?? {}
  const key = Object.keys(env).find((name) => name.toUpperCase() === 'CLAUDE_CONFIG_DIR')
  return key === undefined ? undefined : env[key]
}

const samePath = (a: string | undefined, b: string) => (a ?? '').replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase() === b.replace(/\\+$/, '').toLowerCase()

test.describe('S1: the menu lists the commands of the Claude folder of the profile', () => {
  test('B8: a session of profile A lists only skill-a, and a session of profile B lists only skill-b', async ({ chat }) => {
    const check = 'B8'
    const skills: Record<Profile, string> = { personal: 'skill-a', client: 'skill-b' }
    for (const profile of Object.keys(PROFILES) as Profile[]) {
      await addSkill(claudeFolderOf(chat, profile), skills[profile], `The fake skill of ${PROFILES[profile]}.`)
    }
    await chat.control.scenario('commands', { skills: true, chunks: REPLY_CHUNKS })
    const page = await startWithProfiles(chat)

    // Profile A: "Personal".
    await setClaudeFolder(page, 'personal', claudeFolderOf(chat, 'personal'), check)
    await openNewSession(page)
    await startRunningSession(chat, page, check, 'Say hello in A')
    expect(
      samePath(lastClaudeFolder(chat), claudeFolderOf(chat, 'personal')),
      `${check} (setup): the agent of profile A must run with the Claude folder of A, not ${lastClaudeFolder(chat)}.`
    ).toBe(true)
    await openMenu(page, `${check} (profile A)`)
    await expectRows(page, ['skill-a'], `${check} (profile A)`)
    await page.keyboard.press('Escape')

    // Profile B: "Client Example".
    await switchProfile(page, 'personal', 'client', check)
    await setClaudeFolder(page, 'client', claudeFolderOf(chat, 'client'), check)
    await openNewSession(page)
    await startRunningSession(chat, page, check, 'Say hello in B')
    expect(
      samePath(lastClaudeFolder(chat), claudeFolderOf(chat, 'client')),
      `${check} (setup): the agent of profile B must run with the Claude folder of B, not ${lastClaudeFolder(chat)}.`
    ).toBe(true)
    await openMenu(page, `${check} (profile B)`)
    await expectRows(page, ['skill-b'], `${check} (profile B)`)
  })
})
