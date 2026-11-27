import { describe, expect, it } from 'vitest'
import { MODES, type Mode } from '../../building-blocks/mode'
import { modeForNewSession, titleOf } from './session'

const at = (mode: Mode, createdAt: string) => ({ mode, createdAt })

describe('modeForNewSession', () => {
  it('starts with Ask when the profile has no session', () => {
    expect(modeForNewSession([])).toBe('ask')
  })

  it.each(MODES.filter((mode) => mode !== 'approve-all'))('copies the mode %s of the newest session', (mode) => {
    expect(modeForNewSession([at('plan', '2026-01-01T00:00:00.000Z'), at(mode, '2026-01-02T00:00:00.000Z')])).toBe(mode)
  })

  it('never copies Approve all: it becomes Ask', () => {
    expect(modeForNewSession([at('auto', '2026-01-01T00:00:00.000Z'), at('approve-all', '2026-01-02T00:00:00.000Z')])).toBe('ask')
    expect(modeForNewSession([at('approve-all', '2026-01-02T00:00:00.000Z')])).toBe('ask')
  })

  it('picks the newest by creation time, not by position in the list', () => {
    const sessions = [at('approve-all', '2026-01-03T00:00:00.000Z'), at('plan', '2026-01-01T00:00:00.000Z'), at('auto', '2026-01-02T00:00:00.000Z')]
    expect(modeForNewSession(sessions)).toBe('ask')
    expect(modeForNewSession([at('auto', '2026-01-03T00:00:00.000Z'), at('approve-all', '2026-01-01T00:00:00.000Z')])).toBe('auto')
  })

  it('ignores an older Approve all: only the newest session counts', () => {
    expect(modeForNewSession([at('approve-all', '2026-01-01T00:00:00.000Z'), at('plan', '2026-01-02T00:00:00.000Z')])).toBe('plan')
  })

  it('takes the later session of the list when two share a creation time', () => {
    const time = '2026-01-01T00:00:00.000Z'
    expect(modeForNewSession([at('auto', time), at('plan', time)])).toBe('plan')
    expect(modeForNewSession([at('plan', time), at('approve-all', time)])).toBe('ask')
  })

  it('does not change its input', () => {
    const sessions = [at('approve-all', '2026-01-02T00:00:00.000Z'), at('plan', '2026-01-01T00:00:00.000Z')]
    const copy = structuredClone(sessions)
    modeForNewSession(sessions)
    expect(sessions).toEqual(copy)
  })
})

describe('titleOf', () => {
  it('takes the first line of the prompt', () => {
    expect(titleOf('Say hello\nThen list the files.')).toBe('Say hello')
    expect(titleOf('Say hello\r\nThen list the files.')).toBe('Say hello')
  })

  it('trims the space around the title', () => {
    expect(titleOf('  Fix the login page  ')).toBe('Fix the login page')
  })

  it('gives an empty title for a blank prompt', () => {
    expect(titleOf('')).toBe('')
    expect(titleOf('\n text')).toBe('')
  })
})
