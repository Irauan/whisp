import { readFileSync } from 'node:fs'
import type { Clock } from '../../../building-blocks/clock.port'
import type { Ids } from '../../../building-blocks/ids'
import { err, ok, type Result } from '../../../building-blocks/result'
import { readOldProfile } from '../old-profile'
import type { ProfileStore } from '../profile.store'
import type { ImportStore } from './import-old-files.store'

/** The old file exists but Aether cannot read it. The file stays where it is. */
export type ImportError = 'workspace-file-unreadable'

export type ImportOutcome =
  | { status: 'imported'; profiles: number; sessions: number }
  | { status: 'already-imported' }
  | { status: 'no-file' }

export interface ImportDeps {
  profiles: ProfileStore
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
 * 0005). Each account becomes a profile without a workspace directory. Each draft becomes a session with the
 * mode of the import order. The import runs once: it ends with a mark in the database, in the
 * same transaction as the rows. The handler only reads the old file. It never writes it, and it
 * never reads `runs/`: the conversations belong to work items, and Aether removed those.
 *
 * - No file: nothing to import. No mark, so that a later file would import.
 * - A file that Aether cannot read: an error, and no mark. The next start tries again.
 */
export function importOldFilesHandler({ profiles, imports, clock, ids, file }: ImportDeps): Result<ImportOutcome, ImportError> {
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
  return profiles.transaction(() => {
    const profileOf = new Map<string, string>()
    for (const account of profile.accounts) {
      const id = ids.next()
      profileOf.set(account.id, id)
      profiles.insert({
        id,
        name: account.label,
        workspaceDirectory: null,
        github: account.github,
        claudeFolder: null,
        claudeProfileName: null,
        createdAt: now
      })
    }
    const current = profileOf.get(profile.currentAccountId)
    if (current) profiles.setCurrent(current)
    for (const draft of profile.drafts) {
      const profileId = profileOf.get(draft.accountId)
      if (profileId) imports.insertDraft({ ...draft, createdAt: draft.createdAt ?? now, id: ids.next(), profileId })
    }
    imports.markImported(now)
    return ok({ status: 'imported', profiles: profile.accounts.length, sessions: profile.drafts.length } as const)
  })
}
