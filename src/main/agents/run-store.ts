import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { emptyRun, isAgentRun, type AgentRun } from '../../shared/agent'

const ITEM_ID = /^[\w-]{1,64}$/

export function isItemId(value: unknown): value is string {
  return typeof value === 'string' && ITEM_ID.test(value)
}

/** Keeps the agent conversation of each work item in its own file. */
export class RunStore {
  private pending = new Map<string, Promise<void>>()

  constructor(private readonly folder: string) {}

  async load(itemId: string): Promise<AgentRun> {
    try {
      const data: unknown = JSON.parse(await readFile(this.path(itemId), 'utf8'))
      if (isAgentRun(data) && data.itemId === itemId) {
        // A turn cannot survive a restart of Aether.
        return { ...data, status: 'idle', question: null }
      }
    } catch {
      // No conversation yet, or an unreadable one: start empty.
    }
    return emptyRun(itemId)
  }

  /** Saves of one item run in order. Each save replaces the file in one step. */
  save(run: AgentRun): Promise<void> {
    const previous = this.pending.get(run.itemId) ?? Promise.resolve()
    const next = previous.then(() => this.write(run)).catch(() => undefined)
    this.pending.set(run.itemId, next)
    return next
  }

  async remove(itemId: string): Promise<void> {
    await this.pending.get(itemId)
    this.pending.delete(itemId)
    await rm(this.path(itemId), { force: true })
  }

  async settled(): Promise<void> {
    await Promise.all(this.pending.values())
  }

  private path(itemId: string): string {
    if (!isItemId(itemId)) throw new Error('Not a work item id.')
    return join(this.folder, `${itemId}.json`)
  }

  private async write(run: AgentRun): Promise<void> {
    await mkdir(this.folder, { recursive: true })
    const file = this.path(run.itemId)
    const temporary = `${file}.tmp`
    await writeFile(temporary, JSON.stringify({ ...run, question: null }, null, 2), 'utf8')
    await rename(temporary, file)
  }
}
