import { ChevronDown, Loader } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { answerPermission } from '../../../features/sessions/answer-permission/answer-permission.contract'
import { answerText, buttonGroups, type AnswersEntry, type ButtonGroup, type Option, type PermissionView } from '../card-view'
import { invokeContract } from '../invoke'
import styles from './Cards.module.css'
import { useStackedWhenWrapping } from './useStackedWhenWrapping'

/** The row of buttons of a card. It stacks the buttons at full width when they would wrap. */
export function ActionRow({ children }: { children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null)
  useStackedWhenWrapping(row, styles.stacked ?? 'stacked')
  return (
    <div ref={row} className={styles.actions}>
      {children}
    </div>
  )
}

/** A compact button of a card. */
export function CardButton(props: { label: string; primary?: boolean; disabled?: boolean; title?: string | undefined; onClick(): void }) {
  return (
    <button type="button" className={props.primary ? `${styles.button} ${styles.primary}` : styles.button} disabled={props.disabled} title={props.title} onClick={props.onClick}>
      {props.label}
    </button>
  )
}

/**
 * One group of options: a plain button for one option, a split button for more. The main part of the
 * split button is the recommended option. The dropdown part opens a menu with the other options.
 */
function GroupButtons({ group, onChoose }: { group: ButtonGroup; onChoose(option: Option): void }) {
  const [open, setOpen] = useState(false)
  const holder = useRef<HTMLSpanElement>(null)

  // Escape and a click outside close the menu.
  useEffect(() => {
    if (!open) return
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !holder.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', close)
    document.addEventListener('pointerdown', close)
    return () => {
      document.removeEventListener('keydown', close)
      document.removeEventListener('pointerdown', close)
    }
  }, [open])

  const main = <CardButton label={group.main.label} primary={group.primary} onClick={() => onChoose(group.main)} />
  if (group.more.length === 0) return main
  const word = group.kind === 'allow' ? 'allow' : 'refuse'
  return (
    <span ref={holder} className={styles.split}>
      {main}
      <button
        type="button"
        className={group.primary ? `${styles.button} ${styles.primary} ${styles.more}` : `${styles.button} ${styles.more}`}
        aria-label={`More ${word} options`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" aria-label={`More ${word} options`} className={styles.menu}>
          {group.more.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onChoose(option)
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

/**
 * The decision card of a permission request, in the transcript at the place of its entry (spec S5). It
 * shows the context (tool kind, title, locations) in the secondary color, the question in the primary
 * color, then the buttons: the allow group and the refuse group, each with its recommended option as
 * the main part. The question comes from the saved entry of the card.
 *
 * An answer switches the card to its answered layout at once, with a spinner, and no disabled button
 * shows. The card keeps its name until main accepts the answer: then the event replaces it. A refused
 * answer brings the buttons back, with the reason under them.
 */
export function PermissionCard({ sessionId, view, entry, ref }: { sessionId: string; view: PermissionView; entry: AnswersEntry; ref?: Ref<HTMLElement> }) {
  const [sending, setSending] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const question = entry.rows[0]?.question ?? ''

  const choose = (option: Option) => {
    if (sending !== null) return
    setSending(option.label)
    setProblem(null)
    void invokeContract(answerPermission, { id: sessionId, requestId: view.id, optionId: option.id }).then((result) => {
      if (result.ok) return
      setSending(null)
      // The card closed already: the event removes it, so there is nothing more to show.
      if (result.error.code !== 'unknown-request') setProblem(result.error.message)
    }).catch(() => {
      // The call itself failed: the buttons come back, with the error line of a refused answer.
      setSending(null)
      setProblem('Aether cannot send this answer.')
    })
  }

  return (
    <article aria-label="Permission request" ref={ref} tabIndex={-1} data-entry-id={view.entryId} className={styles.card}>
      {sending !== null ? (
        <>
          <p className={styles.question}>{question}</p>
          <p className={styles.chosen}>
            <span>{sending}</span>
            <Loader size={14} className="spin" role="img" aria-label="Sending" />
          </p>
        </>
      ) : (
        <>
          <p className={styles.ctx}>
            {view.toolKind !== null && `${view.toolKind} · `}
            <span className={styles.mono}>{view.title}</span>
          </p>
          <p className={styles.ask}>{question}</p>
          {view.locations.length > 0 && (
            <ul className={styles.locations}>
              {view.locations.map((location) => (
                <li key={location} className={styles.mono}>
                  {location}
                </li>
              ))}
            </ul>
          )}
          <ActionRow>
            {buttonGroups(view.options).map((group) => (
              <GroupButtons key={group.kind} group={group} onChoose={choose} />
            ))}
          </ActionRow>
          {problem !== null && (
            <p className={styles.error} role="alert">
              {problem}
            </p>
          )}
        </>
      )}
    </article>
  )
}

/**
 * A decision card that closed: the question in the secondary color, then the chosen label, or the
 * reason that the card has no answer, in the primary color. It has no button, also no disabled one.
 */
export function AnsweredDecision({ entry }: { entry: AnswersEntry }) {
  const row = entry.rows[0]
  return (
    <article aria-label="Permission answered" className={`${styles.card} ${styles.answered}`}>
      <p className={styles.question}>{row?.question ?? ''}</p>
      <p className={styles.chosen}>{answerText(entry, row?.answer ?? null)}</p>
    </article>
  )
}
