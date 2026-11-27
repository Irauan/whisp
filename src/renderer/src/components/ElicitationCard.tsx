import { Loader } from 'lucide-react'
import { useId, useState, type Ref } from 'react'
import type { z } from 'zod'
import { answerElicitation } from '../../../features/sessions/answer-elicitation/answer-elicitation.contract'
import {
  answerText,
  binaryChoice,
  canSubmit,
  customKeyOf,
  emptySelection,
  NOT_ANSWERED,
  pickedText,
  questionFields,
  submittedValues,
  type AnswersEntry,
  type ElicitationView,
  type Field,
  type Selection,
  type Selections
} from '../card-view'
import { invokeContract } from '../invoke'
import { ActionRow, CardButton } from './PermissionCard'
import styles from './Cards.module.css'

type Answer = z.input<typeof answerElicitation.input>['answer']

/** One question of a form, with its option rows and the row "Other". The card holds the selections. */
function Question({
  field,
  fields,
  text,
  header,
  selection,
  onChange
}: {
  field: Field
  fields: readonly Field[]
  /** The question text. */
  text: string
  /** A small header above the question, when the form has several questions. */
  header: string | null
  selection: Selection
  onChange(next: Selection): void
}) {
  const group = useId()
  if (field.kind === 'text') {
    return (
      <div className={styles.block}>
        {header !== null && <p className={styles.header}>{header}</p>}
        <p className={styles.text}>{text}</p>
        <input className={styles.other} type="text" aria-label={field.title ?? text} value={selection.text} onChange={(event) => onChange({ ...selection, text: event.target.value })} />
      </div>
    )
  }
  const multiple = field.kind === 'choices'
  const type = multiple ? 'checkbox' : 'radio'
  const hasOther = customKeyOf(fields, field.key) !== null

  const toggle = (value: string) => {
    if (!multiple) return onChange({ picked: [value], other: false, text: selection.text })
    const picked = selection.picked.includes(value) ? selection.picked.filter((item) => item !== value) : [...selection.picked, value]
    onChange({ ...selection, picked })
  }

  return (
    <div className={styles.block}>
      {header !== null && <p className={styles.header}>{header}</p>}
      <p className={styles.text}>{text}</p>
      <div role={multiple ? 'group' : 'radiogroup'} aria-label={text} className={styles.rows}>
        {field.options.map((option, index) => {
          const id = `${group}-${index}`
          return (
            <label key={option.value} className={styles.row}>
              <input
                type={type}
                name={group}
                checked={selection.picked.includes(option.value)}
                aria-labelledby={`${id}-label`}
                aria-describedby={option.description === null ? undefined : `${id}-note`}
                onChange={() => toggle(option.value)}
              />
              <span>
                <span id={`${id}-label`} className={styles.rowLabel}>
                  {option.label}
                </span>
                {option.description !== null && (
                  <span id={`${id}-note`} className={styles.rowSub}>
                    {option.description}
                  </span>
                )}
              </span>
            </label>
          )
        })}
        {hasOther && (
          <label className={styles.row}>
            <input
              type={type}
              name={group}
              checked={selection.other}
              aria-label="Other"
              onChange={() => onChange(multiple ? { ...selection, other: !selection.other } : { picked: [], other: true, text: selection.text })}
            />
            <span>
              <span className={styles.rowLabel} aria-hidden="true">
                Other
              </span>
              <input
                className={styles.other}
                type="text"
                aria-label="Other"
                value={selection.text}
                // Typing selects the row. A single select drops its pick: the text is the answer.
                onChange={(event) => onChange(multiple ? { ...selection, other: true, text: event.target.value } : { picked: [], other: true, text: event.target.value })}
              />
            </span>
          </label>
        )}
      </div>
    </div>
  )
}

/**
 * The question card of Claude, a form of the agent, in the transcript at the place of its entry. A form
 * that is a binary choice (the refusal fallback) shows two buttons, the recommended one first and
 * primary. Any other form shows each question with its option rows (a radio for one choice, a checkbox
 * for many, each with its explanation) and the row "Other", then "Submit" and "Skip". A click on a row only
 * selects it, nothing is preselected, and "Submit" waits for a pick or a text.
 *
 * An answer switches the card to its answered layout with a spinner. A refused answer brings the card back.
 */
export function ElicitationCard({ sessionId, view, entry, ref }: { sessionId: string; view: ElicitationView; entry: AnswersEntry; ref?: Ref<HTMLElement> }) {
  const [selections, setSelections] = useState<Selections>({})
  // What the card shows while its answer is sent: the rows with their answers, or the chosen label.
  const [sending, setSending] = useState<string[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const questions = questionFields(view.fields)
  const binary = binaryChoice(view)

  const send = (answer: Answer, shown: string[]) => {
    if (sending !== null) return
    setSending(shown)
    setProblem(null)
    void invokeContract(answerElicitation, { id: sessionId, elicitationId: view.id, answer }).then((result) => {
      if (result.ok) return
      setSending(null)
      if (result.error.code !== 'unknown-request') setProblem(result.error.message)
    })
  }

  const submit = () =>
    send(
      { action: 'submit', values: submittedValues(view.fields, selections) },
      questions.map((field) => pickedText(field, selections[field.key] ?? emptySelection) ?? NOT_ANSWERED.skipped)
    )
  const skip = () => send({ action: 'skip' }, questions.map(() => NOT_ANSWERED.skipped))

  const rows = entry.rows
  let body
  if (sending !== null) {
    body = (
      <>
        {binary !== null ? <p className={styles.question}>{view.message}</p> : null}
        {binary !== null
          ? sending.map((line) => (
              <p key={line} className={styles.chosen}>
                <span>{line}</span>
                <Loader size={14} className="spin" aria-hidden="true" />
              </p>
            ))
          : questions.map((field, index) => (
              <div key={field.key} className={styles.answerRow}>
                <p className={styles.question}>{rows[index]?.question ?? ''}</p>
                <p className={styles.chosen}>
                  <span>{sending[index] ?? ''}</span>
                  {index === questions.length - 1 && <Loader size={14} className="spin" aria-hidden="true" />}
                </p>
              </div>
            ))}
      </>
    )
  } else if (binary !== null) {
    body = (
      <>
        <p className={styles.text}>{view.message}</p>
        <ActionRow>
          {[...binary.options]
            .sort((a, b) => Number(b.value === binary.primary) - Number(a.value === binary.primary))
            .map((option) => (
              <CardButton
                key={option.value}
                label={option.label}
                primary={option.value === binary.primary}
                title={option.description ?? undefined}
                onClick={() => send({ action: 'submit', values: { [binary.key]: option.value } }, [option.label])}
              />
            ))}
        </ActionRow>
      </>
    )
  } else {
    body = (
      <>
        {questions.length > 1 && <p className={styles.text}>{view.message}</p>}
        {questions.map((field, index) => (
          <Question
            key={field.key}
            field={field}
            fields={view.fields}
            text={rows[index]?.question ?? view.message}
            header={questions.length > 1 ? field.title : null}
            selection={selections[field.key] ?? emptySelection}
            onChange={(next) => setSelections({ ...selections, [field.key]: next })}
          />
        ))}
        <ActionRow>
          <CardButton label="Submit" primary disabled={!canSubmit(view.fields, selections)} onClick={submit} />
          <CardButton label="Skip" onClick={skip} />
        </ActionRow>
      </>
    )
  }

  return (
    <article aria-label="Claude asks" ref={ref} tabIndex={-1} data-entry-id={view.entryId} className={styles.card}>
      <h3 className={styles.heading}>Claude asks</h3>
      {body}
      {sending === null && problem !== null && (
        <p className={styles.error} role="alert">
          {problem}
        </p>
      )}
    </article>
  )
}

/**
 * A question card that closed: one row for each question, with the question in the secondary color and
 * the answer, or the reason that it has none, in the primary color. It has no button.
 */
export function AnsweredQuestion({ entry }: { entry: AnswersEntry }) {
  return (
    <article aria-label="Claude asked" className={`${styles.card} ${styles.answered}`}>
      <h3 className={styles.heading}>Claude asked</h3>
      {entry.rows.map((row, index) => (
        <div key={index} className={styles.answerRow}>
          <p className={styles.question}>{row.question}</p>
          <p className={styles.chosen}>{answerText(entry, row.answer)}</p>
        </div>
      ))}
    </article>
  )
}
