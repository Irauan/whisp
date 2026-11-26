import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'

/**
 * Removes a workspace and its sessions. Decision 0005: the old `workspace.json` and `runs/` stay
 * as they are. The GitHub CLI and the Claude folder stay as they are too.
 */
export const removeWorkspace = defineContract(
  'workspaces.remove',
  z.strictObject({ id: z.string().min(1) }),
  z.strictObject({}),
  ['unknown-workspace'],
  {
    valid: [{ id: 'w1' }],
    invalid: [null, {}, { id: '' }, { id: 1 }, { id: 'w1', extra: true }]
  }
)

export type RemoveWorkspaceError = (typeof removeWorkspace.errors)[number]
