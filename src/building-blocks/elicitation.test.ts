import { describe, expect, it } from 'vitest'
import type { ElicitationField } from './agent.port'
import { fitsFields } from './elicitation'

const fields: ElicitationField[] = [
  { key: 'one', kind: 'choice', title: null, description: null, options: [{ value: 'a', label: 'A', description: null }, { value: 'b', label: 'B', description: null }] },
  { key: 'many', kind: 'choices', title: null, description: null, options: [{ value: 'x', label: 'X', description: null }, { value: 'y', label: 'Y', description: null }] },
  { key: 'free', kind: 'text', title: null, description: null, completes: null }
]

describe('fitsFields', () => {
  it('accepts a skip, an empty answer and a full answer', () => {
    expect(fitsFields(fields, { action: 'skip' })).toBe(true)
    expect(fitsFields(fields, { action: 'submit', values: {} })).toBe(true)
    expect(fitsFields(fields, { action: 'submit', values: { one: 'b', many: ['x', 'y'], free: 'text' } })).toBe(true)
    expect(fitsFields(fields, { action: 'submit', values: { many: [] } })).toBe(true)
  })

  it.each([
    ['a key that no field has', { other: 'a' }],
    ['a value that is not an option', { one: 'c' }],
    ['a list for a single select', { one: ['a'] }],
    ['a string for a multi select', { many: 'x' }],
    ['a value that is not an option of a multi select', { many: ['x', 'z'] }],
    ['a list for a text', { free: ['x'] }]
  ])('refuses %s', (_name, values) => {
    expect(fitsFields(fields, { action: 'submit', values })).toBe(false)
  })
})
