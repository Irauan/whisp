import { err, ok, type Result } from '../../../building-blocks/result'
import { MESSAGES, titleOf } from '../session'
import type { SessionStore } from '../session.store'
import type { Transcript } from '../transcript.store'
import type { RenameSessionError } from './rename.contract'

export interface RenameSessionDeps {
  store: SessionStore
  transcript: Transcript
}

/**
 * Saves the title that the user typed, with the source `user`. The store saves first. The event goes
 * out only after the save, and only when the title changed. A rename to the same title still sets the
 * source, so that a later title of the agent does not replace it.
 */
export function renameSessionHandler(
  { store, transcript }: RenameSessionDeps,
  { id, title }: { id: string; title: string }
): Result<Record<string, never>, RenameSessionError> {
  const session = store.find(id)
  if (!session) return err('unknown-session', MESSAGES.unknownSession)
  const clean = titleOf(title)
  if (clean === '') return err('blank-title', MESSAGES.blankTitle)
  store.setTitle(id, clean, 'user')
  if (clean !== session.title) transcript.setTitle(id, clean)
  return ok({})
}
