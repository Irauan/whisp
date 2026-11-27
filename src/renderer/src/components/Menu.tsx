import { Check } from 'lucide-react'
import type { ReactNode } from 'react'

export function Menu(props: {
  id: string
  label: string
  trigger: ReactNode
  disabled?: boolean
  /** Opens above the button. */
  above?: boolean
  children: ReactNode
}) {
  return (
    <>
      <button
        type="button"
        className="bar-button"
        aria-label={props.label}
        title={props.label}
        popoverTarget={props.id}
        disabled={props.disabled}
      >
        {props.trigger}
      </button>
      <div
        id={props.id}
        className={props.above ? 'popover above' : 'popover'}
        popover="auto"
        role="group"
        aria-label={props.label}
      >
        {props.children}
      </div>
    </>
  )
}

export function MenuOption(props: {
  /** The menu that closes after the choice. */
  menu: string
  title: string
  note?: string
  tag?: string
  icon?: ReactNode
  hint?: string
  checked?: boolean
  disabled?: boolean
  onSelect(): void
}) {
  return (
    <button
      type="button"
      className="option"
      aria-pressed={props.checked}
      // The text and the tag join without a space, so a screen reader needs the full name.
      aria-label={props.tag ? `${props.title}, ${props.tag.toLowerCase()}` : undefined}
      disabled={props.disabled}
      onClick={props.onSelect}
      popoverTarget={props.menu}
      popoverTargetAction="hide"
    >
      <span className="option-check">{props.icon ?? (props.checked && <Check size={16} />)}</span>
      <span className="option-text">
        {props.title}
        {props.note && <span className="muted">{props.note}</span>}
      </span>
      {props.hint && <span className="muted">{props.hint}</span>}
      {props.tag && <span className="tag">{props.tag}</span>}
    </button>
  )
}
