import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { emptyWorkspace, isWorkspace, type Workspace } from '../shared/model'

export class WorkspaceFile {
  private pending: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async load(): Promise<Workspace> {
    let text: string
    try {
      text = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyWorkspace
      throw error
    }
    let data: unknown = null
    try {
      data = JSON.parse(text)
    } catch {
      // The check below handles unreadable data.
    }
    if (isWorkspace(data)) return data
    // Keep the unreadable file, so that the next save cannot destroy it.
    await rename(this.path, `${this.path}.unreadable-${Date.now()}`)
    return emptyWorkspace
  }

  /** Saves run in order. Each save replaces the file in one step. */
  save(workspace: Workspace): Promise<void> {
    const run = this.pending.then(() => this.write(workspace))
    this.pending = run.catch(() => undefined)
    return run
  }

  /** Resolves when no save is in progress. */
  settled(): Promise<void> {
    return this.pending
  }

  private async write(workspace: Workspace): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.tmp`
    await writeFile(temporary, JSON.stringify(workspace, null, 2), 'utf8')
    await rename(temporary, this.path)
  }
}
