import { describe, expect, it } from 'vitest'
import { answerText, binaryChoice, buttonGroups, canSubmit, NOT_ANSWERED, pickedText, submittedValues, type Field, type Option, type Selections } from './card-view'

const allow = (id: string, label = id): Option => ({ id, label, kind: 'allow-once' })
const always = (id: string, label = id): Option => ({ id, label, kind: 'allow-always' })
const refuse = (id: string, label = id): Option => ({ id, label, kind: 'refuse-once' })
const names = (groups: ReturnType<typeof buttonGroups>) => groups.map((group) => ({ kind: group.kind, main: group.main.id, more: group.more.map((option) => option.id), primary: group.primary }))

describe('buttonGroups', () => {
  it('puts the allow group first and primary, with the other allow options in the dropdown, then the refuse group', () => {
    expect(names(buttonGroups([allow('yes'), always('always'), refuse('no')]))).toEqual([
      { kind: 'allow', main: 'yes', more: ['always'], primary: true },
      { kind: 'refuse', main: 'no', more: [], primary: false }
    ])
  })

  it('takes the first allow-once option as the main part, before an "always" option of the agent (the plan exit)', () => {
    const plan = [always('auto'), always('bypass'), allow('default'), refuse('keep')]
    expect(names(buttonGroups(plan))).toEqual([
      { kind: 'allow', main: 'default', more: ['auto', 'bypass'], primary: true },
      { kind: 'refuse', main: 'keep', more: [], primary: false }
    ])
  })

  it('puts the refuse group first and primary on a safety ask, where the agent offers a refuse option first', () => {
    expect(names(buttonGroups([refuse('no'), allow('yes'), always('always')]))).toEqual([
      { kind: 'refuse', main: 'no', more: [], primary: true },
      { kind: 'allow', main: 'yes', more: ['always'], primary: false }
    ])
  })

  it('makes a split button of a refuse group with two options, in the order of the agent', () => {
    expect(names(buttonGroups([allow('yes'), refuse('no'), { id: 'never', label: 'Never', kind: 'refuse-always' }]))).toEqual([
      { kind: 'allow', main: 'yes', more: [], primary: true },
      { kind: 'refuse', main: 'no', more: ['never'], primary: false }
    ])
  })

  it('makes no button primary when the request has no allow-once option and no refuse option first', () => {
    expect(names(buttonGroups([always('always'), refuse('no')])).map((group) => group.primary)).toEqual([false, false])
    expect(names(buttonGroups([refuse('cancel-request')]))).toEqual([{ kind: 'refuse', main: 'cancel-request', more: [], primary: false }])
  })

  it('shows no group for no option', () => {
    expect(buttonGroups([])).toEqual([])
  })
})

describe('binaryChoice', () => {
  const fallback = {
    fields: [
      {
        key: 'choice',
        kind: 'choice',
        title: null,
        description: null,
        options: [
          { value: 'cancelled', label: 'Keep the refusal', description: null },
          { value: 'retry_fallback', label: 'Retry with claude-opus-5-5', description: null }
        ]
      }
    ] satisfies Field[],
    recommended: 'cancelled'
  }

  it('reads a form with one choice of two options as two buttons, and the recommended one is primary', () => {
    expect(binaryChoice(fallback)).toMatchObject({ key: 'choice', primary: 'cancelled' })
    expect(binaryChoice({ ...fallback, recommended: null })).toMatchObject({ primary: 'cancelled' })
  })

  it('reads no other form as buttons', () => {
    const [choice] = fallback.fields
    expect(binaryChoice({ fields: [], recommended: null })).toBeNull()
    expect(binaryChoice({ fields: [choice!, { key: 'note', kind: 'text', title: null, description: null, completes: null }], recommended: null })).toBeNull()
    expect(binaryChoice({ fields: [{ ...choice!, options: [...choice!.options, { value: 'c', label: 'C', description: null }] } as Field], recommended: null })).toBeNull()
  })
})

const single: Field = {
  key: 'question_0',
  kind: 'choice',
  title: null,
  description: null,
  options: [
    { value: 'Vitest', label: 'Vitest (Recommended)', description: null },
    { value: 'Jest', label: 'Jest', description: null }
  ]
}
const multi: Field = {
  key: 'question_1',
  kind: 'choices',
  title: null,
  description: null,
  options: [
    { value: 'Coverage', label: 'Coverage', description: null },
    { value: 'JUnit', label: 'JUnit XML', description: null },
    { value: 'HTML', label: 'HTML', description: null }
  ]
}
const custom0: Field = { key: 'question_0_custom', kind: 'text', title: 'Other', description: null, completes: 'question_0' }
const custom1: Field = { key: 'question_1_custom', kind: 'text', title: 'Other', description: null, completes: 'question_1' }
const form = [single, custom0, multi, custom1]

describe('what a question card sends', () => {
  it('enables "Submit" only when a question has a pick or a text, and preselects nothing', () => {
    expect(canSubmit(form, {})).toBe(false)
    expect(canSubmit(form, { question_0: { picked: [], other: true, text: '   ' } })).toBe(false)
    expect(canSubmit(form, { question_0: { picked: ['Jest'], other: false, text: '' } })).toBe(true)
    expect(canSubmit(form, { question_1: { picked: [], other: true, text: 'A summary' } })).toBe(true)
    // A text with no selected "Other" row is not sent, so it does not count.
    expect(canSubmit(form, { question_1: { picked: [], other: false, text: 'A summary' } })).toBe(false)
  })

  it('sends the const of a single select, the list of a multi select in the order of the options, and the text only when "Other" is selected', () => {
    const picks: Selections = {
      question_0: { picked: ['Jest'], other: false, text: 'a note that is not sent' },
      question_1: { picked: ['HTML', 'Coverage'], other: true, text: ' A summary ' }
    }
    expect(submittedValues(form, picks)).toEqual({ question_0: 'Jest', question_1: ['Coverage', 'HTML'], question_1_custom: 'A summary' })
  })

  it('sends only the text of "Other" for a question with no pick, and nothing for a question with nothing', () => {
    expect(submittedValues(form, { question_0: { picked: [], other: true, text: 'Mocha' } })).toEqual({ question_0_custom: 'Mocha' })
    expect(submittedValues(form, {})).toEqual({})
  })

  it('sends the text of a form field that is only text, as an MCP form has it', () => {
    const token: Field = { key: 'token', kind: 'text', title: 'Token', description: null, completes: null }
    expect(canSubmit([token], {})).toBe(false)
    expect(submittedValues([token], { token: { picked: [], other: false, text: ' t0k ' } })).toEqual({ token: 't0k' })
  })

  it('shows the picks of a card while its answer is sent: the labels, then the text', () => {
    expect(pickedText(multi, { picked: ['HTML', 'Coverage'], other: true, text: 'A summary' })).toBe('Coverage, HTML, A summary')
    expect(pickedText(single, { picked: [], other: false, text: '' })).toBeNull()
  })
})

describe('answerText', () => {
  it('gives the saved answer, or the reason that the card has none', () => {
    expect(answerText({ outcome: 'submitted' }, 'Allow')).toBe('Allow')
    expect(answerText({ outcome: 'stopped' }, null)).toBe(NOT_ANSWERED.stopped)
    expect(answerText({ outcome: 'withdrawn' }, null)).toBe('Not answered: Claude withdrew it.')
    expect(answerText({ outcome: 'exited' }, null)).toBe('Not answered: Claude Code exited.')
    expect(answerText({ outcome: 'quit' }, null)).toBe('Not answered: Aether closed.')
    expect(answerText({ outcome: 'interrupted' }, null)).toBe('Not answered: Aether stopped unexpectedly.')
    expect(answerText({ outcome: 'skipped' }, null)).toBe('Not answered: you skipped it.')
  })

  it('says that a submitted question with no answer was skipped, and shows a card that Aether lost as interrupted', () => {
    expect(answerText({ outcome: 'submitted' }, null)).toBe('Not answered: you skipped it.')
    expect(answerText({ outcome: 'open' }, null)).toBe('Not answered: Aether stopped unexpectedly.')
  })
})
