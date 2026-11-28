import { describe, expect, it } from 'vitest'
import { LOG_MARKER, splitLog, withLog } from './log-marker'

describe('withLog and splitLog', () => {
  it('round trips a message with log lines, also when the message has many lines', () => {
    for (const message of ['Claude Code stopped (exit code 7).', 'Claude Code did not start. A\nB\nC']) {
      const text = withLog(message, 'line one\nline two')
      expect(text).toContain(LOG_MARKER)
      expect(splitLog(text)).toEqual({ message, log: 'line one\nline two' })
    }
  })

  it('adds nothing when there are no log lines', () => {
    expect(withLog('Claude Code stopped (exit code 1).', '')).toBe('Claude Code stopped (exit code 1).')
  })

  it('finds no log in a text without the marker, such as the sign-in steps', () => {
    const text = 'Claude Code is not signed in.\n1. Open a terminal.\n2. Run claude.'
    expect(splitLog(text)).toEqual({ message: text, log: null })
  })

  it('finds no log when only blank lines follow the marker', () => {
    expect(splitLog(`Stopped.\n${LOG_MARKER}\n  \n`)).toEqual({ message: 'Stopped.', log: null })
  })
})
