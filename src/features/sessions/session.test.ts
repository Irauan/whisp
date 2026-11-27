import { describe, expect, it } from 'vitest'
import { MODES, type Mode } from '../../building-blocks/mode'
import { FILE_KINDS, modeForNewSession, TITLE_LIMIT, textForAgent, titleOf, unsupportedAttachment, URL_KINDS, type Attachment } from './session'

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

const attachment = (kind: string, ref = 'x', label = 'x'): Attachment => ({ kind, ref, label })

describe('unsupportedAttachment', () => {
  it('accepts no attachment, and each kind that the agent gets', () => {
    expect(unsupportedAttachment([])).toBeNull()
    expect(unsupportedAttachment([...FILE_KINDS, ...URL_KINDS].map((kind) => attachment(kind)))).toBeNull()
  })

  it('names an attachment of a kind that Aether does not know, and says its kind', () => {
    expect(unsupportedAttachment([attachment('file'), attachment('snippet', 'a', 'notes.txt')])).toMatch(/"snippet"/)
  })

  it('refuses a session attachment: it is coming soon (decision 0012)', () => {
    expect(unsupportedAttachment([attachment('session', 's1', 'Old chat')])).toMatch(/Old chat.*coming soon/i)
  })
})

describe('textForAgent', () => {
  it('keeps the text when no attachment is an issue or a pull request', () => {
    expect(textForAgent('Read it', [attachment('file', 'C:\\a.txt')])).toBe('Read it')
    expect(textForAgent('Read it', [])).toBe('Read it')
  })

  it('adds the URL of each issue and pull request after the text (decision 0012, item 5)', () => {
    const text = textForAgent('Fix it', [
      attachment('issue', 'https://github.com/example/repo/issues/7'),
      attachment('file', 'C:\\a.txt'),
      attachment('pull-request', 'https://github.com/example/repo/pull/9')
    ])
    expect(text).toBe('Fix it\n\nReferences:\nhttps://github.com/example/repo/issues/7\nhttps://github.com/example/repo/pull/9')
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

  it('limits the title to TITLE_LIMIT characters, and never cuts a character in two', () => {
    expect(titleOf('a'.repeat(TITLE_LIMIT + 50))).toBe('a'.repeat(TITLE_LIMIT))
    expect(titleOf('x'.repeat(TITLE_LIMIT - 1) + '😀😀')).toBe('x'.repeat(TITLE_LIMIT - 1) + '😀')
    expect(titleOf('a'.repeat(TITLE_LIMIT - 1) + ' b')).toBe('a'.repeat(TITLE_LIMIT - 1))
  })

  it('gives an empty title for a blank prompt', () => {
    expect(titleOf('')).toBe('')
    expect(titleOf('\n text')).toBe('')
  })
})
