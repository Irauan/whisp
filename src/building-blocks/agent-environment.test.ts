import { describe, expect, it } from 'vitest'
import { ALLOWED_VARIABLES, allowedEnvironment } from './agent-environment'

describe('allowedEnvironment', () => {
  it('keeps the variables of the allow list and nothing else', () => {
    const result = allowedEnvironment({
      PATH: 'C:\\tools',
      SystemRoot: 'C:\\Windows',
      USERPROFILE: 'C:\\Users\\someone',
      ANTHROPIC_API_KEY: 'x',
      FOO: 'y',
      GH_TOKEN: 'fake-token',
      GITHUB_TOKEN: 'fake-token',
      CLAUDE_CODE_OAUTH_TOKEN: 'fake-token',
      CLAUDE_CONFIG_DIR: 'C:\\claude',
      AETHER_DATA_DIR: 'C:\\data'
    })
    expect(result).toEqual({ PATH: 'C:\\tools', SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\someone' })
  })

  it('matches names without case, as Windows does, and keeps the name of the source', () => {
    expect(allowedEnvironment({ Path: 'C:\\tools', systemroot: 'C:\\Windows', Temp: 'C:\\t' })).toEqual({
      Path: 'C:\\tools',
      systemroot: 'C:\\Windows',
      Temp: 'C:\\t'
    })
  })

  it('skips a variable without a value', () => {
    expect(allowedEnvironment({ PATH: undefined, TEMP: 'C:\\t' })).toEqual({ TEMP: 'C:\\t' })
  })

  it('never lists a Claude, Anthropic, GH or GitHub variable', () => {
    const bad = ALLOWED_VARIABLES.filter((name) => /^(claude|anthropic|gh|github)(_|$)/i.test(name))
    expect(bad).toEqual([])
  })

  it('does not change its input', () => {
    const source = { PATH: 'a', FOO: 'b' }
    allowedEnvironment(source)
    expect(source).toEqual({ PATH: 'a', FOO: 'b' })
  })
})
