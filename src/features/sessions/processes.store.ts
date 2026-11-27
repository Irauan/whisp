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
  private readonly processes = new Map<string, AgentProcess>()
  private readonly turns = new Map<string, Turn>()
  private readonly running = new Set<Promise<void>>()

  get(sessionId: string): AgentProcess | undefined {
    return this.processes.get(sessionId)
  }

  set(sessionId: string, process: AgentProcess): void {
    this.processes.set(sessionId, process)
  }

  /** Forgets the process, when it is still the process of the session. A newer process stays. */
  drop(sessionId: string, process: AgentProcess): void {
    if (this.processes.get(sessionId) === process) this.processes.delete(sessionId)
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

  /** Stops the turn of a session and ends its process. The session can start a new process later. */
  async release(sessionId: string): Promise<void> {
    const turn = this.turns.get(sessionId)
    if (turn) turn.stopped = true
    const process = this.processes.get(sessionId)
    this.processes.delete(sessionId)
    await process?.close()
  }

  /** Ends all processes and waits for the turns that they ended, for example when Aether quits. */
  async releaseAll(): Promise<void> {
    await Promise.all([...new Set([...this.processes.keys(), ...this.turns.keys()])].map((id) => this.release(id)))
    await this.settled()
  }
}
