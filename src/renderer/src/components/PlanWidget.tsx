import { Check, ChevronDown, Circle, Loader } from 'lucide-react'
import { useId, useState } from 'react'
import { planCount, type SessionSnapshot } from '../session-view'
import styles from './PlanWidget.module.css'

type Entry = SessionSnapshot['entries'][number]['entry']
type Step = Extract<Entry, { kind: 'plan' }>['steps'][number]

/** The state of each step as text. The text is visually hidden: the icon shows it to the eye. */
const STATE_TEXT: Record<Step['status'], string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed'
}

function StepIcon({ status }: { status: Step['status'] }) {
  switch (status) {
    case 'completed':
      return <Check size={16} className={styles.done} aria-hidden="true" />
    case 'in_progress':
      return <Loader size={16} className={`${styles.active} spin`} aria-hidden="true" />
    case 'pending':
      return <Circle size={16} className={styles.waiting} aria-hidden="true" />
  }
}

/**
 * The latest plan of the session as a todo list, in the bottom dock (story S8). The header shows
 * "Plan N of M": N completed steps of M. The user folds it. The fold state is view state: a new
 * plan keeps it, and a new window starts unfolded.
 */
export function PlanWidget({ steps }: { steps: readonly Step[] }) {
  const [open, setOpen] = useState(true)
  const listId = useId()
  const { done, total } = planCount(steps)

  return (
    <section aria-label="Plan" className={styles.widget}>
      <button type="button" className={styles.head} aria-expanded={open} aria-controls={listId} onClick={() => setOpen(!open)}>
        <ChevronDown size={16} className={styles.chevron} aria-hidden="true" />
        <span className={styles.title}>{`Plan ${done} of ${total}`}</span>
      </button>
      {open && (
        <ul id={listId} className={styles.steps}>
          {steps.map((step, index) => (
            <li key={index} className={step.status === 'completed' ? styles.completed : undefined}>
              <StepIcon status={step.status} />
              <span>{step.text}</span>
              <span className={styles.hidden}>{STATE_TEXT[step.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
