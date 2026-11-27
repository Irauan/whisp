import { describe, expect, it } from 'vitest'
import { MODES } from '../../building-blocks/mode'
import { CLAUDE_MODES, claudeCodeRecipe, signInSteps } from './claude-code'

describe('claudeCodeRecipe', () => {
  it('translates each mode of the port to a permission mode of Claude (decision 0012)', () => {
    expect(CLAUDE_MODES).toEqual({
      ask: 'default',
      'accept-edits': 'acceptEdits',
      plan: 'plan',
      auto: 'auto',
      'approve-all': 'bypassPermissions'
    })
    const recipe = claudeCodeRecipe()
    expect(MODES.map((mode) => recipe.modeId(mode))).toEqual(['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'])
  })

  it('starts the adapter that Aether ships with, as plain Node, with the Console sign-in only', async () => {
    const launch = await claudeCodeRecipe().launch({})
    expect(launch.ok).toBe(true)
    if (!launch.ok) return
    expect(launch.value.command).toBe(process.execPath)
    expect(launch.value.args[0]).toMatch(/claude-agent-acp.*index\.js$/)
    expect(launch.value.args).toContain('--hide-claude-auth')
    expect(launch.value.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
  })

  it('sets the Claude variables from the settings, and no other Claude variable', async () => {
    const launch = await claudeCodeRecipe().launch({ configFolder: 'C:\\claude-one', profileName: 'work' })
    expect(launch.ok && launch.value.env).toEqual({
      ELECTRON_RUN_AS_NODE: '1',
      CLAUDE_CONFIG_DIR: 'C:\\claude-one',
      ANTHROPIC_PROFILE: 'work'
    })
  })

  it('lets an entry of agents.json replace only the program and the arguments', async () => {
    const recipe = claudeCodeRecipe({ override: async () => ({ command: 'C:\\fake\\agent.exe', args: ['--test'] }) })
    const launch = await recipe.launch({ configFolder: 'C:\\claude-one' })
    expect(launch).toEqual({
      ok: true,
      value: {
        command: 'C:\\fake\\agent.exe',
        args: ['--test'],
        env: { ELECTRON_RUN_AS_NODE: '1', CLAUDE_CONFIG_DIR: 'C:\\claude-one' }
      }
    })
    expect(recipe.modeId('auto')).toBe('auto')
    expect(recipe.name).toBe('Claude Code')
  })

  it('uses the built-in program when agents.json has no entry', async () => {
    const launch = await claudeCodeRecipe({ override: async () => null }).launch({})
    expect(launch.ok && launch.value.command).toBe(process.execPath)
  })

  it('refuses settings that the schema does not accept', async () => {
    expect(await claudeCodeRecipe().launch({ configFolder: 3 })).toMatchObject({ ok: false, error: { code: 'invalid-settings' } })
    expect(await claudeCodeRecipe().launch({ configFolder: '' })).toMatchObject({ ok: false })
  })
})

describe('signInSteps', () => {
  it('starts with the sentence of the state "Not signed in"', () => {
    expect(signInSteps({})).toMatch(/^Claude Code is not signed in\. \S/)
  })

  it('names the Claude folder and the Claude profile name of the settings', () => {
    const text = signInSteps({ configFolder: 'C:\\claude-one', profileName: 'work' })
    expect(text).toContain('Set CLAUDE_CONFIG_DIR to C:\\claude-one.')
    expect(text).toContain('Set ANTHROPIC_PROFILE to work.')
    expect(text).toContain('auth login --console')
  })

  it('does not tell the user to set an API key in the environment of Aether', () => {
    expect(signInSteps({})).not.toContain('ANTHROPIC_API_KEY')
  })
})
