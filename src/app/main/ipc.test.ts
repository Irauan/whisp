import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import { defineContract } from '../../building-blocks/contract'
import { ok } from '../../building-blocks/result'
import { createInvoke, createSubscribe, type SenderEvent } from './ipc'

const echo = defineContract('things.echo', z.strictObject({ text: z.string() }), z.string(), ['empty'], {
  valid: [{ text: 'a' }],
  invalid: [{}, null]
})

const trusted: SenderEvent = { sender: { id: 1, send: vi.fn(), isDestroyed: () => false } }
const stranger: SenderEvent = { sender: { id: 2, send: vi.fn(), isDestroyed: () => false } }
const isTrusted = (event: SenderEvent) => event.sender.id === 1

function setup(controller: (input: never) => Promise<unknown> = async () => ok('done')) {
  const run = vi.fn(controller)
  const log = vi.fn()
  const invoke = createInvoke({
    contracts: [echo],
    controllers: { [echo.name]: run },
    isTrusted,
    log
  })
  return { invoke, run, log }
}

describe('invoke', () => {
  it('parses the input, runs the controller and returns its result', async () => {
    const { invoke, run } = setup(async (input: never) => ok(`got ${(input as { text: string }).text}`))
    expect(await invoke(trusted, 'things.echo', { text: 'hi' })).toEqual({ ok: true, value: 'got hi' })
    expect(run).toHaveBeenCalledOnce()
  })

  it('refuses a sender that is not a frame of the app and runs no controller', async () => {
    const { invoke, run } = setup()
    expect(await invoke(stranger, 'things.echo', { text: 'hi' })).toMatchObject({
      ok: false,
      error: { code: 'forbidden' }
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses an unknown name, also a name from Object.prototype, and runs no controller', async () => {
    const { invoke, run } = setup()
    for (const name of ['things.missing', 'constructor', '__proto__', 'toString', '', 42, null, {}]) {
      expect(await invoke(trusted, name, {}), String(name)).toMatchObject({
        ok: false,
        error: { code: 'unknown-contract' }
      })
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses invalid input and runs no controller', async () => {
    const { invoke, run } = setup()
    for (const input of [undefined, null, 'x', 42, {}, { text: 1 }, { text: 'a', extra: 1 }]) {
      expect(await invoke(trusted, 'things.echo', input), JSON.stringify(input)).toMatchObject({
        ok: false,
        error: { code: 'invalid-input' }
      })
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('logs a defect and returns a generic message', async () => {
    const { invoke, log } = setup(async () => {
      throw new Error('secret detail of the defect')
    })
    const result = await invoke(trusted, 'things.echo', { text: 'hi' })
    expect(result).toEqual({ ok: false, error: { code: 'defect', message: 'Something went wrong.' } })
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(log).toHaveBeenCalledOnce()
  })

  it('reports a contract without a controller as a defect', async () => {
    const log = vi.fn()
    const invoke = createInvoke({ contracts: [echo], controllers: {}, isTrusted, log })
    expect(await invoke(trusted, 'things.echo', { text: 'hi' })).toMatchObject({
      ok: false,
      error: { code: 'defect' }
    })
    expect(log).toHaveBeenCalledOnce()
  })

  it('returns a defect when the controller result does not match the contract', async () => {
    const { invoke, log } = setup(async () => ({ ok: true, value: 42 }))
    expect(await invoke(trusted, 'things.echo', { text: 'hi' })).toMatchObject({
      ok: false,
      error: { code: 'defect' }
    })
    expect(log).toHaveBeenCalledOnce()
  })
})

describe('subscribe', () => {
  const setupSubscribe = () => {
    const subscribe = createSubscribe({ events: ['things.changed'], isTrusted })
    return subscribe
  }

  it('accepts a name of the event list from a frame of the app', () => {
    const { handler } = setupSubscribe()
    expect(handler(trusted, 'things.changed')).toEqual({ ok: true, value: null })
  })

  it('refuses an unknown name and a sender that is not a frame of the app', () => {
    const { handler } = setupSubscribe()
    expect(handler(trusted, 'things.other')).toMatchObject({ ok: false, error: { code: 'unknown-contract' } })
    expect(handler(trusted, 'constructor')).toMatchObject({ ok: false, error: { code: 'unknown-contract' } })
    expect(handler(stranger, 'things.changed')).toMatchObject({ ok: false, error: { code: 'forbidden' } })
  })

  it('sends an event only to the subscribers of its name', () => {
    const { handler, publish } = setupSubscribe()
    const send = vi.fn()
    handler({ sender: { id: 1, send, isDestroyed: () => false } }, 'things.changed')
    publish('things.changed', { revision: 1 })
    expect(send).toHaveBeenCalledWith('aether:event', 'things.changed', { revision: 1 })
    publish('things.other', {})
    expect(send).toHaveBeenCalledOnce()
  })
})
