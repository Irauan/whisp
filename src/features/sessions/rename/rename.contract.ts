import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'

/**
 * Renames a session (story S10, the menu item "Rename"). The main process cleans the title with
 * `titleOf`: the first line, no space around it, cut at the title limit. A title with no text is
 * refused, and so is a session that has not started (a draft shows "New session"). The title then has the source `user`, and no title from the agent replaces it.
 */
export const renameSession = defineContract(
  'sessions.rename',
  z.strictObject({ id: z.string().min(1), title: z.string().max(10_000) }),
  z.strictObject({}),
  ['unknown-session', 'blank-title', 'draft'],
  {
    valid: [
      { id: 's1', title: 'My name' },
      { id: 's1', title: '   ' }
    ],
    invalid: [
      null,
      {},
      { id: 's1' },
      { title: 'My name' },
      { id: '', title: 'My name' },
      { id: 's1', title: 5 },
      { id: 's1', title: 'x'.repeat(10_001) },
      { id: 's1', title: 'a', extra: true }
    ]
  }
)

export type RenameSessionError = (typeof renameSession.errors)[number]
