import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'
import { workspaceDirectorySchema } from '../profile'

/** Saves the workspace directory of each profile that the user chose in the dialog "Choose workspace directories". One change for all. */
export const chooseDirectories = defineContract(
  'profiles.choose-directories',
  z.strictObject({
    directories: z
      .array(z.strictObject({ profileId: z.string().min(1), workspaceDirectory: workspaceDirectorySchema }))
      .min(1)
      .max(100)
  }),
  z.strictObject({}),
  ['unknown-profile', 'invalid-workspace-directory'],
  {
    valid: [
      { directories: [{ profileId: 'w1', workspaceDirectory: 'C:\\work' }] },
      {
        directories: [
          { profileId: 'w1', workspaceDirectory: 'C:\\work' },
          { profileId: 'w2', workspaceDirectory: ' C:\\client ' }
        ]
      }
    ],
    invalid: [
      null,
      {},
      { directories: [] },
      { directories: [{ profileId: 'w1' }] },
      { directories: [{ profileId: 'w1', workspaceDirectory: '  ' }] },
      { directories: [{ profileId: '', workspaceDirectory: 'C:\\work' }] },
      { directories: [{ profileId: 'w1', workspaceDirectory: 'C:\\work', extra: true }] }
    ]
  }
)

export type ChooseDirectoriesError = (typeof chooseDirectories.errors)[number]
