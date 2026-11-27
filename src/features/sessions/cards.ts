import type { CloseReason, Elicitation, ElicitationAnswer, ElicitationField, PermissionRequest } from '../../building-blocks/agent.port'
import type { AnswerOutcome, AnswersEntry, ElicitationView, PermissionView } from './entry'

/**
 * The cards of the agent: a permission request and a form. These pure functions build the saved
 * `answers` entry of a card at each stage, and the view of its request (spec S5, "Data").
 */

/** What the process of an agent tells about its open requests. */
export type AgentRequestEvent =
  | { type: 'permission'; request: PermissionRequest }
  | { type: 'permission-closed'; id: string; reason: CloseReason }
  | { type: 'elicitation'; form: Elicitation }
  | { type: 'elicitation-closed'; id: string; reason: CloseReason }

/** What the card shows when the request names no tool kind that Aether knows. */
const ANY_TOOL = 'Allow this tool?'

/** The question text of a decision card for a tool kind (spec S5, "Decision cards"). */
export function decisionQuestion(toolKind: string | null): string {
  switch (toolKind) {
    case 'execute':
      return 'Run this command?'
    case 'edit':
    case 'delete':
    case 'move':
      return 'Make this change?'
    case 'read':
    case 'search':
      return 'Read this?'
    case 'fetch':
      return 'Fetch this?'
    case 'switch_mode':
      return 'Approve the plan?'
    default:
      return ANY_TOOL
  }
}

/** The tool that an earlier announcement of the call gave, when the request has less than it needs. */
export interface KnownTool {
  title: string
  toolKind: string
}

/** The view of a permission request. The title and the kind come from the request, then from the announced call, then from the defaults. */
export function permissionView(request: PermissionRequest, entryId: string, known: KnownTool | null): PermissionView {
  return {
    id: request.id,
    entryId,
    toolId: request.toolId,
    title: request.title ?? known?.title ?? 'Tool call',
    toolKind: request.toolKind ?? known?.toolKind ?? null,
    locations: request.locations,
    options: request.options
  }
}

/** The saved entry of a decision card that opens: one row with the question and no answer. */
export function openDecision(view: Pick<PermissionView, 'toolId' | 'toolKind'>): AnswersEntry {
  return { kind: 'answers', card: 'decision', toolId: view.toolId, outcome: 'open', rows: [{ question: decisionQuestion(view.toolKind), answer: null }] }
}

/** The fields that ask a question: every field except a text that completes a choice. */
export const questionsOf = (fields: readonly ElicitationField[]): ElicitationField[] =>
  fields.filter((field) => !(field.kind === 'text' && field.completes !== null))

/** The question text of a field. A form with one question uses the message of the agent. */
function questionText(field: ElicitationField, form: Pick<Elicitation, 'message'>, count: number): string {
  if (count === 1) return form.message
  return field.description ?? field.title ?? form.message
}

/** The saved entry of a question card that opens: one row for each question, with no answer. */
export function openQuestion(form: Pick<Elicitation, 'toolId' | 'message' | 'fields'>): AnswersEntry {
  const questions = questionsOf(form.fields)
  return {
    kind: 'answers',
    card: 'question',
    toolId: form.toolId,
    outcome: 'open',
    rows: questions.map((field) => ({ question: questionText(field, form, questions.length), answer: null }))
  }
}

/** The entry of a card that closed without an answer: the same rows, each with no answer. */
export function closedWithout(entry: AnswersEntry, outcome: Exclude<AnswerOutcome, 'open' | 'submitted'>): AnswersEntry {
  return { ...entry, outcome, rows: entry.rows.map(({ question }) => ({ question, answer: null })) }
}

/** The entry of a decision card that the user answered: the label of the chosen option. */
export function answeredDecision(entry: AnswersEntry, label: string): AnswersEntry {
  return { ...entry, outcome: 'submitted', rows: entry.rows.map(({ question }) => ({ question, answer: label })) }
}

/** The text that a form that can hold a secret saves in place of the typed text. */
export const ANSWERED = 'Answered'

/**
 * The entry of a form that the user answered. A row holds the labels of the picked options, then the
 * typed text, joined with ", ", or null when the question has neither. A form that cannot keep its
 * text (it can hold a secret) saves "Answered" in place of the typed text. A skip saves no answer.
 */
export function answeredQuestion(entry: AnswersEntry, form: Pick<ElicitationView, 'fields'> & { keepsText: boolean }, answer: ElicitationAnswer): AnswersEntry {
  if (answer.action === 'skip') return closedWithout(entry, 'skipped')
  const questions = questionsOf(form.fields)
  const rows = entry.rows.map(({ question }, index) => {
    const field = questions[index]
    if (!field) return { question, answer: null }
    const parts: string[] = []
    const value = answer.values[field.key]
    if (field.kind === 'choice' && typeof value === 'string') parts.push(field.options.find((option) => option.value === value)?.label ?? value)
    if (field.kind === 'choices' && Array.isArray(value)) {
      parts.push(...field.options.filter((option) => value.includes(option.value)).map((option) => option.label))
    }
    const completing = form.fields.find((other) => other.kind === 'text' && other.completes === field.key)
    const typed = field.kind === 'text' ? field : completing
    const text = typed ? answer.values[typed.key] : undefined
    if (typeof text === 'string' && text.trim() !== '') parts.push(form.keepsText ? text.trim() : ANSWERED)
    return { question, answer: parts.length === 0 ? null : parts.join(', ') }
  })
  return { ...entry, outcome: 'submitted', rows }
}
