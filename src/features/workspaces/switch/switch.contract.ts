import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'

/** Makes a workspace the current one. Aether saves the choice for the next start. */
export const switchWorkspace = defineContract(
  'workspaces.switch',
  z.strictObject({ id: z.string().min(1) }),
  z.strictObject({}),
  ['unknown-workspace'],
  {
    valid: [{ id: 'w1' }],
    invalid: [null, {}, { id: '' }, { id: 1 }, { id: 'w1', extra: true }]
  }
)

export type SwitchWorkspaceError = (typeof switchWorkspace.errors)[number]
