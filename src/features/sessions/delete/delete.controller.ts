import type { Database } from '../../../building-blocks/database'
import { SessionStore } from '../session.store'
import { deleteSessionHandler } from './delete.handler'

/**
 * The input is already parsed against the contract. After the row is gone, `release` ends what the
 * session still holds in memory: its agent process and its open turn. The composition root passes it,
 * because a slice never calls another slice.
 */
export const deleteSessionController = (database: Database, release: (id: string) => Promise<void>) => async (input: { id: string }) => {
  const result = deleteSessionHandler(new SessionStore(database), input)
  if (result.ok) await release(input.id)
  return result
}
