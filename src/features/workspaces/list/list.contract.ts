import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'
import { noticeSchema, workspaceViewSchema } from '../workspace'

/**
 * Loads the snapshot of the workspaces: each workspace, the current one, and the messages about
 * the start of Aether. The renderer loads a new snapshot after each change.
 */
export const listWorkspaces = defineContract(
  'workspaces.list',
  z.strictObject({}),
  z.strictObject({
    workspaces: z.array(workspaceViewSchema),
    /** Null when no workspace exists. */
    currentId: z.string().nullable(),
    notices: z.array(noticeSchema)
  }),
  [],
  {
    valid: [{}],
    invalid: [null, 'not an object', 42, [], { extra: true }]
  }
)
