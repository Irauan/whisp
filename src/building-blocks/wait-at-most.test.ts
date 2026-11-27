import { describe, expect, it, vi } from 'vitest'
import { waitAtMost } from './wait-at-most'

describe('waitAtMost', () => {
  it('resolves done when the work ends first, also when it rejects', async () => {
    expect(await waitAtMost(Promise.resolve(1), 1000)).toBe('done')
    expect(await waitAtMost(Promise.reject(new Error('x')), 1000)).toBe('done')
  })

  it('resolves timeout when the work does not end within the limit', async () => {
    vi.useFakeTimers()
    try {
      const result = waitAtMost(new Promise<void>(() => undefined), 5000)
      await vi.advanceTimersByTimeAsync(5000)
      expect(await result).toBe('timeout')
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves no timer behind after the work ends', async () => {
    vi.useFakeTimers()
    try {
      await waitAtMost(Promise.resolve(), 5000)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
