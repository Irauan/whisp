import type { ElicitationChoice } from '../../building-blocks/agent.port'

/** A field of a form, before the recipe says which text field completes which choice. */
export type FormField =
  | { key: string; kind: 'choice' | 'choices'; title: string | null; description: string | null; options: ElicitationChoice[] }
  | { key: string; kind: 'text'; title: string | null; description: string | null }

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

/** The options of a `oneOf` or an `anyOf`, or null when one of them has no `const` (Aether cannot show it). */
function optionsOf(items: unknown): ElicitationChoice[] | null {
  if (!Array.isArray(items) || items.length === 0) return null
  const options: ElicitationChoice[] = []
  for (const item of items) {
    if (!isObject(item) || typeof item.const !== 'string') return null
    options.push({ value: item.const, label: textOrNull(item.title) ?? item.const, description: textOrNull(item.description) })
  }
  return options
}

/** One property of the schema, or null when Aether does not render it. */
function fieldOf(key: string, property: unknown): FormField | null {
  if (!isObject(property)) return null
  const common = { key, title: textOrNull(property.title), description: textOrNull(property.description) }
  if (property.type === 'string') {
    if ('oneOf' in property) {
      const options = optionsOf(property.oneOf)
      return options === null ? null : { ...common, kind: 'choice', options }
    }
    // A string with an `enum` or a `format` (a date, an e-mail) needs a control that Aether does not have.
    if ('enum' in property || textOrNull(property.format) !== null) return null
    return { ...common, kind: 'text' }
  }
  if (property.type === 'array' && isObject(property.items)) {
    const options = optionsOf(property.items.anyOf)
    return options === null ? null : { ...common, kind: 'choices', options }
  }
  return null
}

/**
 * The fields of the form of an `elicitation/create` request, in the order of the agent. Aether renders
 * a string with `oneOf` (a single select), an array with `items.anyOf` (a multi select) and a plain
 * string (a text field). One other field makes the whole form unsupported, and so does a form with no
 * field: the result is then null, and the caller answers with the error -32602.
 */
export function fieldsOfSchema(schema: unknown): FormField[] | null {
  if (!isObject(schema) || !isObject(schema.properties)) return null
  const entries = Object.entries(schema.properties)
  if (entries.length === 0) return null
  const fields: FormField[] = []
  for (const [key, property] of entries) {
    const field = fieldOf(key, property)
    if (field === null) return null
    fields.push(field)
  }
  return fields
}
