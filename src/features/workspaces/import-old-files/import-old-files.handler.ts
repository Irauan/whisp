import { readFileSync } from 'node:fs'
import type { Clock } from '../../../building-blocks/clock.port'
import type { Ids } from '../../../building-blocks/ids'
import { err, ok, type Result } from '../../../building-blocks/result'
import { readOldProfile } from '../old-profile'
import type { WorkspaceStore } from '../workspace.store'
import type { ImportStore } from './import-old-files.store'

/** The old file exists but Aether cannot read it. The file stays where it is. */
export type ImportError = 'workspace-file-unreadable'

export type ImportOutcome =
  | { status: 'imported'; workspaces: number; sessions: number }
  | { status: 'already-imported' }
  | { status: 'no-file' }

export interface ImportDeps {
  workspaces: WorkspaceStore
  imports: ImportStore
  clock: Clock
  ids: Ids
  /** The path of the old `workspace.json`. */
  file: string
}

export const UNREADABLE_MESSAGE =
  'Aether could not read workspace.json. The file stays where it is, and Aether does not change it.'

/**
 * Imports the accounts and the session drafts of the old `workspace.json` (decisions 0003 and
 * 0005). Each account becomes a workspace without a root. Each draft becomes a session with the
 * mode of the import order. The import runs once: it ends with a mark in the database, in the
 * same transaction as the rows. The handler only reads the old file. It never writes it, and it
 * never reads `runs/`: the conversations belong to work items, and Aether removed those.
 *
 * - No file: nothing to import. No mark, so that a later file would import.
 * - A file that Aether cannot read: an error, and no mark. The next start tries again.
 */
export function importOldFilesHandler({ workspaces, imports, clock, ids, file }: ImportDeps): Result<ImportOutcome, ImportError> {
  if (imports.imported()) return ok({ status: 'already-imported' })

  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return ok({ status: 'no-file' })
    return err('workspace-file-unreadable', UNREADABLE_MESSAGE)
  }
  const profile = readOldProfile(text)
  if (!profile) return err('workspace-file-unreadable', UNREADABLE_MESSAGE)

  const now = clock.now().toISOString()
  return workspaces.transaction(() => {
    const workspaceOf = new Map<string, string>()
    for (const account of profile.accounts) {
      const id = ids.next()
      workspaceOf.set(account.id, id)
      workspaces.insert({
        id,
        name: account.label,
        root: null,
        github: account.github,
        claudeFolder: null,
        claudeProfile: null,
        createdAt: now
      })
    }
    const current = workspaceOf.get(profile.currentAccountId)
    if (current) workspaces.setCurrent(current)
    for (const draft of profile.drafts) {
      const workspaceId = workspaceOf.get(draft.accountId)
      if (workspaceId) imports.insertDraft({ ...draft, createdAt: draft.createdAt ?? now, id: ids.next(), workspaceId })
    }
    imports.markImported(now)
    return ok({ status: 'imported', workspaces: profile.accounts.length, sessions: profile.drafts.length } as const)
  })
}
