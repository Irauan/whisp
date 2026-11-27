// A16 of milestone m1-chat, on the built app. It covers the defect "The agent receives the whole
// environment of Aether." of `docs/architecture.md`.
//
// A16: Aether runs with ANTHROPIC_API_KEY=x and FOO=y in its environment. A session starts. The
// agent environment has neither. It has GH_TOKEN of the GitHub account of the profile.
// Architecture, Agent environment: Aether builds it from an allow list, never passes on a Claude
// or Anthropic variable from its own environment, and sets GH_TOKEN to the token of the GitHub
// account of the profile.
//
// The profile has the GitHub account example-user-two. The fake `gh` has example-user-one as its
// active account, and Aether has a GH_TOKEN of its own. So only the token of the profile account
// passes. All tokens are fake. A failure message names variables, never values of the real environment.
// No test sleeps. Each wait is an auto-waiting check of Playwright, or a report of the agent.
import {
  ACTIVE_ACCOUNT_TOKEN,
  DRAFT_IN_REPO_A,
  expect,
  expectInTranscript,
  GITHUB,
  reach,
  startImported,
  startSession,
  test,
  tokenOf,
  variable,
  writeOldProfile
} from './fixture'

const AETHER_GH_TOKEN = 'fake-gh-token-of-aether'

test.describe('A16: the agent environment comes from an allow list', () => {
  test('A16: the agent gets neither ANTHROPIC_API_KEY nor FOO of Aether, and GH_TOKEN of the GitHub account of the profile', async ({
    chat
  }) => {
    const leakedClaudeFolder = `${chat.root}\\claude-folder-of-aether`
    await chat.control.scenario('text', { chunks: ['Hello ', 'from the agent.'] })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A], GITHUB.two)
    const page = await startImported(chat, {
      ANTHROPIC_API_KEY: 'x',
      FOO: 'y',
      CLAUDE_CODE_OAUTH_TOKEN: 'fake-oauth-token-of-aether',
      CLAUDE_CONFIG_DIR: leakedClaudeFolder,
      GH_TOKEN: AETHER_GH_TOKEN
    })
    await startSession(page, 'Say hello', 'A16')
    const start = await reach(chat.control.waitForEnvironment(), 'A16: the session started no agent process.')
    await expectInTranscript(page, 'Hello from the agent.', 'A16: the session gets no reply.')

    const { env } = start
    expect(variable(env, 'ANTHROPIC_API_KEY') === undefined, 'A16: the agent environment has ANTHROPIC_API_KEY of Aether.').toBe(true)
    expect(variable(env, 'FOO') === undefined, 'A16: the agent environment has FOO of Aether.').toBe(true)
    expect(
      variable(env, 'CLAUDE_CODE_OAUTH_TOKEN') === undefined,
      'A16 (architecture): the agent environment has CLAUDE_CODE_OAUTH_TOKEN of Aether.'
    ).toBe(true)
    expect(
      variable(env, 'CLAUDE_CONFIG_DIR') === leakedClaudeFolder,
      'A16 (architecture): the agent environment has CLAUDE_CONFIG_DIR of Aether. The profile has no Claude folder.'
    ).toBe(false)

    const token = variable(env, 'GH_TOKEN')
    const found =
      token === undefined
        ? 'no GH_TOKEN'
        : token === AETHER_GH_TOKEN
          ? 'the GH_TOKEN of Aether'
          : token === ACTIVE_ACCOUNT_TOKEN || token === tokenOf(GITHUB.one)
            ? 'the token of the active account of gh, not of the profile'
            : 'another value'
    expect(token, `A16: the agent must get GH_TOKEN of the GitHub account @${GITHUB.two} of the profile. It got ${found}.`).toBe(
      tokenOf(GITHUB.two)
    )
  })
})
