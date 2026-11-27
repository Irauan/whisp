import type { SessionSnapshot } from './session-view'

/**
 * The pure rules of the cards in the transcript (story S5): which buttons a decision card shows and in
 * which order, what a question card sends, and the text of a card that closed without an answer.
 */

export type PermissionView = SessionSnapshot['permissions'][number]
export type ElicitationView = SessionSnapshot['elicitations'][number]
export type Option = PermissionView['options'][number]
export type Field = ElicitationView['fields'][number]
type EntryView = SessionSnapshot['entries'][number]
export type AnswersEntry = Extract<EntryView['entry'], { kind: 'answers' }>

/** The texts of a card that closed without an answer (spec S5, "Cards that closed without an answer"). */
export const NOT_ANSWERED: Record<Exclude<AnswersEntry['outcome'], 'open' | 'submitted'>, string> = {
  stopped: 'Not answered: you pressed Stop.',
  withdrawn: 'Not answered: Claude withdrew it.',
  exited: 'Not answered: Claude Code exited.',
  quit: 'Not answered: Aether closed.',
  interrupted: 'Not answered: Aether stopped unexpectedly.',
  skipped: 'Not answered: you skipped it.'
}

/**
 * The text of one row of an answered card: the saved answer, or the reason that the card has none. An
 * entry with the outcome `open` and no live request is a card that Aether lost (a race, or a crash that
 * the start did not repair yet): it shows the text of `interrupted`.
 */
export function answerText(entry: Pick<AnswersEntry, 'outcome'>, answer: string | null): string {
  if (answer !== null) return answer
  if (entry.outcome === 'open') return NOT_ANSWERED.interrupted
  // A submitted form with a question that has no pick and no text.
  if (entry.outcome === 'submitted') return NOT_ANSWERED.skipped
  return NOT_ANSWERED[entry.outcome]
}

/** One group of buttons of a decision card: the options of one meaning, with the recommended one as the main part. */
export interface ButtonGroup {
  kind: 'allow' | 'refuse'
  /** The recommended option: the main part of the button. */
  main: Option
  /** The other options of the group, in the order of the agent. They show in the dropdown. */
  more: Option[]
  /** True for the button that the user is meant to press. */
  primary: boolean
}

const isAllow = (option: Option): boolean => option.kind === 'allow-once' || option.kind === 'allow-always'

/**
 * The buttons of a decision card (spec S5, "Decision cards"). The allow options form one group and the
 * refuse options another. The recommended option of the allow group is its first `allow-once` option, or
 * its first option. The recommended option of the refuse group is its first option. The allow group
 * comes first and is primary when the group has an `allow-once` option. A safety ask has a refuse option
 * first, and an allow option after it: then the refuse group comes first and is primary. Any other
 * request has no primary button, for example a request that offers a refuse option only.
 */
export function buttonGroups(options: readonly Option[]): ButtonGroup[] {
  const allow = options.filter(isAllow)
  const refuse = options.filter((option) => !isAllow(option))
  const safety = options[0] !== undefined && !isAllow(options[0]) && allow.length > 0
  const group = (kind: ButtonGroup['kind'], list: Option[], primary: boolean): ButtonGroup[] => {
    const main = kind === 'allow' ? (list.find((option) => option.kind === 'allow-once') ?? list[0]) : list[0]
    return main === undefined ? [] : [{ kind, main, more: list.filter((option) => option !== main), primary }]
  }
  const allowGroup = group('allow', allow, !safety && allow.some((option) => option.kind === 'allow-once'))
  const refuseGroup = group('refuse', refuse, safety)
  return safety ? [...refuseGroup, ...allowGroup] : [...allowGroup, ...refuseGroup]
}

/**
 * The two buttons of a form that is a binary choice (the refusal fallback of Claude): one choice field
 * with two options and no other field. The primary button is the recommended option, or the first.
 */
export function binaryChoice(form: Pick<ElicitationView, 'fields' | 'recommended'>): { key: string; options: { value: string; label: string; description: string | null }[]; primary: string } | null {
  const [only] = form.fields
  if (form.fields.length !== 1 || only?.kind !== 'choice' || only.options.length !== 2) return null
  const primary = only.options.find((option) => option.value === form.recommended) ?? only.options[0]
  return primary === undefined ? null : { key: only.key, options: only.options, primary: primary.value }
}

/** A field that asks a question: every field except a text that completes a choice. */
export const questionFields = (fields: readonly Field[]): Field[] => fields.filter((field) => !(field.kind === 'text' && field.completes !== null))

/** What the user chose for one question. */
export interface Selection {
  /** The values of the picked options. A single select holds at most one. */
  picked: string[]
  /** True when the row "Other" is selected. */
  other: boolean
  /** The text of the "Other" field, or the text of a form field that is only text. */
  text: string
}

export type Selections = Record<string, Selection>

export const emptySelection: Selection = { picked: [], other: false, text: '' }

const pickOf = (picks: Selections, key: string): Selection => picks[key] ?? emptySelection

/** The key of the text field that completes a question, or null. */
export const customKeyOf = (fields: readonly Field[], key: string): string | null => fields.find((field) => field.kind === 'text' && field.completes === key)?.key ?? null

/** True when the question has a pick or a text. */
function isAnswered(field: Field, pick: Selection): boolean {
  if (field.kind === 'text') return pick.text.trim() !== ''
  return pick.picked.length > 0 || (pick.other && pick.text.trim() !== '')
}

/** "Submit" is enabled when at least one question has a pick or a text. No row is preselected. */
export function canSubmit(fields: readonly Field[], picks: Selections): boolean {
  return questionFields(fields).some((field) => isAnswered(field, pickOf(picks, field.key)))
}

/**
 * The values that "Submit" sends: the value of a single select, the list of a multi select, and the
 * text of "Other" only when its row is selected. A question with nothing sends no key.
 */
export function submittedValues(fields: readonly Field[], picks: Selections): Record<string, string | string[]> {
  const values: Record<string, string | string[]> = {}
  for (const field of questionFields(fields)) {
    const pick = pickOf(picks, field.key)
    const text = pick.text.trim()
    if (field.kind === 'text') {
      if (text !== '') values[field.key] = text
      continue
    }
    if (pick.picked.length > 0) {
      const ordered = field.options.filter((option) => pick.picked.includes(option.value)).map((option) => option.value)
      values[field.key] = field.kind === 'choices' ? ordered : (ordered[0] ?? '')
    }
    const custom = customKeyOf(fields, field.key)
    if (custom !== null && pick.other && text !== '') values[custom] = text
  }
  return values
}

/** The picks as the card shows them while the answer is sent: the labels, then the typed text, or the reason of a skip. */
export function pickedText(field: Field, pick: Selection): string | null {
  if (!isAnswered(field, pick)) return null
  if (field.kind === 'text') return pick.text.trim()
  const labels = field.options.filter((option) => pick.picked.includes(option.value)).map((option) => option.label)
  return [...labels, ...(pick.other && pick.text.trim() !== '' ? [pick.text.trim()] : [])].join(', ')
}
