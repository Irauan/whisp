import { ArrowUp, Plus, Square } from 'lucide-react'
import type { CSSProperties, KeyboardEvent } from 'react'
import type { Mode } from '../useProfiles'
import { ModeMenu } from './ModeMenu'
import { ModelMenu } from './ModelMenu'
import styles from './ReplyComposer.module.css'

/** The most lines of the text area before it scrolls inside. The only place of this number. */
export const COMPOSER_MAX_LINES = 8

/**
 * The composer of the session window, like the composer of the GitHub app (story S8): one rounded
 * box. The text area is 2 lines high at least, and it grows up to `COMPOSER_MAX_LINES` lines. The
 * control row sits inside the box, at its bottom: "Add context" (disabled), the Mode control and the
 * model button at the left, and Send or Stop at the right. There is no row below the box.
 * Enter sends. Shift+Enter adds a line.
 */
export function ReplyComposer(props: {
  text: string
  mode: Mode
  model: string
  /** True while the session is a draft: the user can still choose the mode and the model. */
  draft: boolean
  /** True while a turn runs: the button is Stop. */
  running: boolean
  /** True when Send can send. */
  ready: boolean
  onText(text: string): void
  onMode(mode: Mode): void
  onModel(model: string): void
  onSend(): void
  onStop(): void
}) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    props.onSend()
  }

  return (
    <form
      className={styles.composer}
      style={{ '--max-lines': COMPOSER_MAX_LINES } as CSSProperties}
      onSubmit={(event) => {
        event.preventDefault()
        props.onSend()
      }}
    >
      <div className={styles.box}>
        <textarea
          aria-label="Prompt"
          className={styles.field}
          placeholder="Reply to Claude"
          rows={2}
          value={props.text}
          onChange={(event) => props.onText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className={styles.controls}>
          {/* The name stays "Add context". The title is its description, and its tooltip. */}
          <button type="button" className={styles.plus} aria-label="Add context" title="Coming soon" disabled>
            <Plus size={16} aria-hidden="true" />
          </button>
          <ModeMenu mode={props.mode} disabled={!props.draft} above className={styles.control} onChange={props.onMode} />
          <ModelMenu model={props.model} disabled={!props.draft} above className={styles.control} onChange={props.onModel} />
          <span className={styles.spacer} />
          {props.running ? (
            <button type="button" className={styles.send} aria-label="Stop" title="Stop" onClick={props.onStop}>
              <Square size={14} aria-hidden="true" />
            </button>
          ) : (
            <button type="submit" className={styles.send} aria-label="Send" title="Send" disabled={!props.ready}>
              <ArrowUp size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </form>
  )
}
