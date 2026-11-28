import { afterEach, describe, expect, it, vi } from 'vitest'
import { switchProfile } from '../../features/profiles/switch/switch.contract'
import type { AetherBridge } from '../../shared/bridge'
import { invokeContract } from './invoke'

// The same declaration as `main.tsx`. The test program does not include that file.
declare global {
  interface Window {
    aether: AetherBridge
  }
}

afterEach(() => vi.unstubAllGlobals())

const bridge = (invoke: (name: string, input: unknown) => Promise<unknown>) =>
  vi.stubGlobal('window', { aether: { invoke } })

describe('invokeContract', () => {
  it('calls the bridge with the name of the contract and returns a checked answer', async () => {
    const invoke = vi.fn(async () => ({ ok: true, value: {} }))
    bridge(invoke)
    expect(await invokeContract(switchProfile, { id: 'w1' })).toEqual({ ok: true, value: {} })
    expect(invoke).toHaveBeenCalledWith('profiles.switch', { id: 'w1' })
  })

  it('returns an error of the slice as it is', async () => {
    bridge(async () => ({ ok: false, error: { code: 'unknown-profile', message: 'No such profile.' } }))
    expect(await invokeContract(switchProfile, { id: 'w1' })).toEqual({
      ok: false,
      error: { code: 'unknown-profile', message: 'No such profile.' }
    })
  })

  it('returns the error defect for an answer that does not match the contract', async () => {
    bridge(async () => ({ ok: false, error: { code: 'not-a-code', message: 'x' } }))
    expect(await invokeContract(switchProfile, { id: 'w1' })).toMatchObject({ ok: false, error: { code: 'defect' } })
  })

  it('returns the error defect when the bridge rejects, and never throws', async () => {
    bridge(async () => {
      throw new Error('No handler.')
    })
    expect(await invokeContract(switchProfile, { id: 'w1' })).toMatchObject({
      ok: false,
      error: { code: 'defect', message: expect.stringContaining('No handler.') }
    })
  })
})
