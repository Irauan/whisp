import type { Ids } from '../../building-blocks/ids'
import { OFFERED, type Answer, type NewQuestion, type Question, type QuestionEvent } from './question'

interface Open {
  question: Question
  settle(answer: Answer): void
}

export type AnswerOutcome = 'answered' | 'unknown' | 'not-offered'

/**
 * The questions that wait for the user, in memory (architecture, State). A question has its own ID
 * and belongs to one session. A turn that waits for an answer holds the promise of `ask`. The list
 * and its revision change in one synchronous step, so a snapshot and its revision never disagree.
 * A restart of Aether drops the questions: no turn survives it.
 */
export class Questions {
  private readonly open = new Map<string, Open>()
  private readonly cancelled = new Map<string, number>()
  private everything = 0
  private revision = 0

  constructor(
    private readonly publish: (event: QuestionEvent) => void,
    private readonly ids: Ids
  ) {}

  /** The open questions, oldest first, with the revision that matches them. */
  snapshot(): { revision: number; questions: Question[] } {
    return { revision: this.revision, questions: [...this.open.values()].map((entry) => entry.question) }
  }

  /**
   * A mark of the cancel state of a session. The gate takes it before it does work that can wait, for
   * example a scan of the folder. A cancel after the mark makes `ask` answer `cancel` at once, so a
   * stop, a delete or a quit during that work never leaves a question open.
   */
  mark(sessionId: string): string {
    return `${this.everything}:${this.cancelled.get(sessionId) ?? 0}`
  }

  /**
   * Opens a question and waits for its answer. The promise never rejects: a wake-up answers `cancel`.
   * With a `mark` that a cancel has passed, it opens nothing and answers `cancel`.
   */
  ask(question: NewQuestion, mark?: string): Promise<Answer> {
    if (mark !== undefined && mark !== this.mark(question.sessionId)) return Promise.resolve('cancel')
    const full = { ...question, id: this.ids.next() } as Question
    return new Promise<Answer>((resolve) => {
      this.open.set(full.id, { question: full, settle: resolve })
      this.emit({ type: 'opened', question: full })
    })
  }

  /** Answers a question. The main process refuses an answer that the kind of the question does not offer. */
  answer(sessionId: string, id: string, answer: Answer): AnswerOutcome {
    const found = this.open.get(id)
    // A stale answer, or one for another session, changes nothing.
    if (!found || found.question.sessionId !== sessionId) return 'unknown'
    if (!OFFERED[found.question.kind].includes(answer)) return 'not-offered'
    this.close(found, answer)
    return 'answered'
  }

  /** Answers `cancel` for each open question of the session: Stop, delete and quit use it. */
  cancelSession(sessionId: string): void {
    this.cancelled.set(sessionId, (this.cancelled.get(sessionId) ?? 0) + 1)
    for (const found of [...this.open.values()]) {
      if (found.question.sessionId === sessionId) this.close(found, 'cancel')
    }
  }

  cancelAll(): void {
    this.everything += 1
    for (const found of [...this.open.values()]) this.close(found, 'cancel')
  }

  private close(found: Open, answer: Answer): void {
    this.open.delete(found.question.id)
    this.emit({ type: 'closed', id: found.question.id })
    found.settle(answer)
  }

  private emit(change: QuestionEvent['change']): void {
    this.revision += 1
    this.publish({ revision: this.revision, change })
  }
}
