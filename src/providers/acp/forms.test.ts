import { describe, expect, it } from 'vitest'
import { fieldsOfSchema } from './forms'

const choice = { type: 'string', title: 'Runner', description: 'Which one?', oneOf: [{ const: 'a', title: 'Option A', description: 'First.' }, { const: 'b' }] }

describe('fieldsOfSchema', () => {
  it('reads a single select, a multi select and a text, in the order of the agent', () => {
    const fields = fieldsOfSchema({
      type: 'object',
      properties: {
        one: choice,
        many: { type: 'array', title: 'Reports', items: { anyOf: [{ const: 'x', title: 'X' }] } },
        free: { type: 'string', title: 'Other' }
      }
    })
    expect(fields).toEqual([
      {
        key: 'one',
        kind: 'choice',
        title: 'Runner',
        description: 'Which one?',
        options: [
          { value: 'a', label: 'Option A', description: 'First.' },
          { value: 'b', label: 'b', description: null }
        ]
      },
      { key: 'many', kind: 'choices', title: 'Reports', description: null, options: [{ value: 'x', label: 'X', description: null }] },
      { key: 'free', kind: 'text', title: 'Other', description: null }
    ])
  })

  it.each([
    ['a number', { type: 'number' }],
    ['an integer', { type: 'integer' }],
    ['a boolean', { type: 'boolean' }],
    ['a string with an enum', { type: 'string', enum: ['a', 'b'] }],
    ['a string with a format', { type: 'string', format: 'email' }],
    ['an array without anyOf', { type: 'array', items: { type: 'string' } }],
    ['a oneOf that is empty', { type: 'string', oneOf: [] }],
    ['a oneOf with an option that has no const', { type: 'string', oneOf: [{ title: 'x' }] }],
    ['a property that is not an object', 'text']
  ])('makes the whole form unsupported when one field is %s', (_name, property) => {
    expect(fieldsOfSchema({ type: 'object', properties: { ok: choice, bad: property } })).toBeNull()
  })

  it.each([[null], [{}], [{ type: 'object' }], [{ type: 'object', properties: {} }], [{ properties: 'x' }]])('gives null for the schema %j', (schema) => {
    expect(fieldsOfSchema(schema)).toBeNull()
  })
})
