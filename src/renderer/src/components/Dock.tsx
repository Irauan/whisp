import type { ReactNode } from 'react'
import styles from './Dock.module.css'

/**
 * The bottom dock of the session window (story S8): always in view, below the transcript. From the
 * top it holds the status line, the plan widget and the composer. It holds no card, and it never
 * scrolls: the parts that can grow have a cap of their own.
 */
export function Dock({ children }: { children: ReactNode }) {
  return (
    <div className={styles.dock}>
      <div className={styles.inner}>{children}</div>
    </div>
  )
}
