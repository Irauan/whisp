import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'
import { sessionSchema } from '../session'

/** Lists the sessions of one workspace, oldest first. In this version they are the drafts of the import. */
export const listSessions = defineContract(
  'sessions.list',
  z.strictObject({ workspaceId: z.string().min(1) }),
  z.strictObject({ sessions: z.array(sessionSchema) }),
  [],
  {
    valid: [{ workspaceId: 'w1' }],
    invalid: [null, {}, { workspaceId: '' }, { workspaceId: 1 }, { workspaceId: 'w1', extra: true }]
  }
)
