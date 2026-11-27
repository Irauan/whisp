import type { ElicitationAnswer, ElicitationField } from './agent.port'

/**
 * True when the answer fits the fields of the form. A choice takes the value of one of its options, a
 * multi select takes values of its options, and a text takes a string. A key that no field has is
 * invalid. A skip always fits. Both the main process and the provider check an answer with this
 * function, so a window that a compromised renderer controls cannot send a value that the form never offered.
 */
export function fitsFields(fields: readonly ElicitationField[], answer: ElicitationAnswer): boolean {
  if (answer.action === 'skip') return true
  for (const [key, value] of Object.entries(answer.values)) {
    const field = fields.find((candidate) => candidate.key === key)
    if (!field) return false
    switch (field.kind) {
      case 'choice':
        if (typeof value !== 'string' || !field.options.some((option) => option.value === value)) return false
        break
      case 'choices':
        if (!Array.isArray(value) || value.some((item) => !field.options.some((option) => option.value === item))) return false
        break
      case 'text':
        if (typeof value !== 'string') return false
        break
    }
  }
  return true
}
