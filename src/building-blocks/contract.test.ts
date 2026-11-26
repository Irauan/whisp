import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { defineContract } from './contract'

const make = (name = 'things.list-things') =>
  defineContract(name, z.object({ limit: z.number() }), z.object({ things: z.array(z.string()) }), ['no-things'], {
    valid: [{ limit: 1 }],
    invalid: [{}, null]
  })

describe('defineContract', () => {
  it('keeps the name, the schemas, the errors and the examples', () => {
    const contract = make()
    expect(contract.name).toBe('things.list-things')
    expect(contract.errors).toEqual(['no-things'])
    expect(contract.input.safeParse({ limit: 1 }).success).toBe(true)
    expect(contract.examples.valid).toEqual([{ limit: 1 }])
    expect(contract.examples.invalid).toEqual([{}, null])
  })

  it('refuses a name that is not <feature>.<action> in lower case', () => {
    for (const name of ['', 'things', 'Things.list', 'things.List', 'things.list.more', 'things. list'])
      expect(() => make(name), name).toThrow(/name/i)
  })

  it('builds an output schema for a success', () => {
    const { output } = make()
    expect(output.safeParse({ ok: true, value: { things: ['a'] } }).success).toBe(true)
    expect(output.safeParse({ ok: true, value: { things: [1] } }).success).toBe(false)
  })

  it('builds an output schema for the errors of the contract and the common errors', () => {
    const { output } = make()
    for (const code of ['no-things', 'unknown-contract', 'invalid-input', 'forbidden', 'defect']) {
      expect(output.safeParse({ ok: false, error: { code, message: 'Text.' } }).success, code).toBe(true)
    }
    expect(output.safeParse({ ok: false, error: { code: 'other', message: 'Text.' } }).success).toBe(false)
    expect(output.safeParse({ ok: false, error: { code: 'defect' } }).success).toBe(false)
  })
})
