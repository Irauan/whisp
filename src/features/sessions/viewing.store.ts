/**
 * What the user looks at now: the session that the window shows, and whether the window has the focus
 * (story S11, "The unread mark"). It lives in memory in the main process, so `send-message` reads it at a
 * turn end without a call to another slice. The composition root feeds it: `set-viewing` sets the
 * session, and the window events `focus`, `blur` and `closed` set the rest.
 *
 * A session is seen when it is the viewed session and the window has the focus. At each change that
 * makes a session seen, `onSeen` runs with its ID, so that the composition root clears its unread mark.
 * An error of `onSeen` is logged, and it does not leave the class.
 */
export class Viewing {
  private viewed: string | null = null
  private focused = false

  constructor(private readonly onSeen: (sessionId: string) => void = () => undefined) {}

  /** The session that the window shows, or null. */
  viewedSession(): string | null {
    return this.viewed
  }

  /** True when the user looks at this session now: it is the viewed session, and the window has the focus. */
  isSeen(sessionId: string): boolean {
    return this.focused && this.viewed === sessionId
  }

  setViewed(sessionId: string | null): void {
    this.viewed = sessionId
    this.checkSeen()
  }

  setFocused(focused: boolean): void {
    this.focused = focused
    this.checkSeen()
  }

  /** The window closed: nothing is viewed, and nothing has the focus. */
  reset(): void {
    this.viewed = null
    this.focused = false
  }

  /**
   * `onSeen` writes to the database. It runs inside the focus event of the window, so a failure is logged
   * and stops here: an exception must not reach the main process.
   */
  private checkSeen(): void {
    if (!this.focused || this.viewed === null) return
    try {
      this.onSeen(this.viewed)
    } catch (error) {
      console.error('Aether could not clear the unread mark of a session.', error instanceof Error ? error.message : error)
    }
  }
}
