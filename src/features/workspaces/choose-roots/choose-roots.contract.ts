import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'
import { rootSchema } from '../workspace'

/** Saves the root of each workspace that the user chose in the dialog "Choose workspace roots". One change for all. */
export const chooseRoots = defineContract(
  'workspaces.choose-roots',
  z.strictObject({
    roots: z
      .array(z.strictObject({ workspaceId: z.string().min(1), root: rootSchema }))
      .min(1)
      .max(100)
  }),
  z.strictObject({}),
  ['unknown-workspace', 'invalid-root'],
  {
    valid: [
      { roots: [{ workspaceId: 'w1', root: 'C:\\work' }] },
      {
        roots: [
          { workspaceId: 'w1', root: 'C:\\work' },
          { workspaceId: 'w2', root: ' C:\\client ' }
        ]
      }
    ],
    invalid: [
      null,
      {},
      { roots: [] },
      { roots: [{ workspaceId: 'w1' }] },
      { roots: [{ workspaceId: 'w1', root: '  ' }] },
      { roots: [{ workspaceId: '', root: 'C:\\work' }] },
      { roots: [{ workspaceId: 'w1', root: 'C:\\work', extra: true }] }
    ]
  }
)

export type ChooseRootsError = (typeof chooseRoots.errors)[number]
