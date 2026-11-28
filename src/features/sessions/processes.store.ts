import type { AgentProcess } from '../../building-blocks/agent.port'

/** The turn of a session that runs now. Stop sets `stopped`, also before the process exists. */
export interface Turn {
  stopped: boolean
}

/**
 * The agent processes of the sessions and their running turns, in memory (architecture, Agents).
 * A session has at most one process. A turn does not survive a restart of Aether.
 */
export class Processes {
  /**
   * `gone` is called when the process of a session leaves: a crash, a release and a close. The
   * composition root uses it to drop what only the process knew, such as the live mode.
   */
  constructor(private readonly gone: (sessionId: string) => void = () => undefined) {}

  private readonly processes = new Map<string, AgentProcess>()
  private readonly turns = new Map<string, Turn>()
  private readonly running = new Set<Promise<void>>()
  /** Since when each session with a process is idle (spec S9). A session with no entry has no idle time. */
  private readonly idleTimes = new Map<string, Date>()
  /** The close of each process that a release closes now. A new start waits for it (spec S9, rules 7 and 8). */
  private readonly closing = new Map<string, Promise<void>>()

  get(sessionId: string): AgentProcess | undefined {
    return this.processes.get(sessionId)
  }

  /** The IDs of the sessions that have an open process. */
  openSessions(): string[] {
    return [...this.processes.keys()]
  }

  set(sessionId: string, process: AgentProcess): void {
    this.processes.set(sessionId, process)
    // A new process is not idle until its first turn ends.
    this.idleTimes.delete(sessionId)
  }

  /** Forgets the process, when it is still the process of the session. A newer process stays. */
  drop(sessionId: string, process: AgentProcess): void {
    if (this.processes.get(sessionId) !== process) return
    this.processes.delete(sessionId)
    this.idleTimes.delete(sessionId)
    this.gone(sessionId)
  }

  /**
   * Marks the time since which the session is idle: the end of a turn, the close of its last open
   * card, or an update of the agent outside a turn. A session without a process has no idle time.
   */
  markIdle(sessionId: string, at: Date): void {
    if (this.processes.has(sessionId)) this.idleTimes.set(sessionId, at)
  }

  /** Since when the session is idle, or null when it has no process or never ended a turn. */
  idleSince(sessionId: string): Date | null {
    return this.idleTimes.get(sessionId) ?? null
  }

  beginTurn(sessionId: string): Turn {
    const turn: Turn = { stopped: false }
    this.turns.set(sessionId, turn)
    return turn
  }

  turnOf(sessionId: string): Turn | undefined {
    return this.turns.get(sessionId)
  }

  /** Ends the turn, when it is still the turn of the session. */
  endTurn(sessionId: string, turn: Turn): void {
    if (this.turns.get(sessionId) === turn) this.turns.delete(sessionId)
  }

  /** Remembers a turn that runs, so that `settled` can wait for it. The promise must never reject. */
  track(turn: Promise<void>): void {
    this.running.add(turn)
    void turn.then(() => this.running.delete(turn))
  }

  /** Resolves when all tracked turns ended. */
  async settled(): Promise<void> {
    while (this.running.size > 0) await Promise.all([...this.running])
  }

  /**
   * Closes the process of an idle session (the release of spec S9, named `retire` here, because
   * `release` closes a session for delete or quit). It checks that the session has no turn, takes
   * the process out and starts the close, all in one synchronous step, with no `await` between. So
   * a message that comes later finds no process and waits for `closed`. Returns the close, which
   * can reject when `close` of the process does, or null when there was nothing to close.
   */
  retire(sessionId: string): Promise<void> | null {
    if (this.turns.has(sessionId)) return null
    const process = this.processes.get(sessionId)
    if (!process) return null
    this.processes.delete(sessionId)
    this.idleTimes.delete(sessionId)
    this.gone(sessionId)
    const closed: Promise<void> = process.close().finally(() => {
      if (this.closing.get(sessionId) === closed) this.closing.delete(sessionId)
    })
    this.closing.set(sessionId, closed)
    return closed
  }

  /** Resolves when the process that a release closes now has ended. It resolves at once when none closes. It never rejects. */
  async closed(sessionId: string): Promise<void> {
    await this.closing.get(sessionId)?.catch(() => undefined)
  }

  /** Stops the turn of a session and ends its process. The session can start a new process later. */
  async release(sessionId: string): Promise<void> {
    const turn = this.turns.get(sessionId)
    if (turn) turn.stopped = true
    const process = this.processes.get(sessionId)
    this.processes.delete(sessionId)
    this.idleTimes.delete(sessionId)
    if (process) this.gone(sessionId)
    await process?.close()
    // A release of the idle rule can be in flight: wait for it, so that no process outlives a delete or a quit.
    await this.closed(sessionId)
  }

  /** Ends all processes and waits for the turns that they ended, for example when Aether quits. */
  async releaseAll(): Promise<void> {
    const ids = new Set([...this.processes.keys(), ...this.turns.keys(), ...this.closing.keys()])
    await Promise.all([...ids].map((id) => this.release(id)))
    await this.settled()
  }
}
