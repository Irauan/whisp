import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'
import { folderSchema } from '../folder'

/**
 * Adds a folder to the sidebar of a profile. It exists with no session under it. A folder that the
 * profile has already gives the existing row.
 */
export const addFolder = defineContract(
  'folders.add',
  z.strictObject({ profileId: z.string().min(1), path: z.string().min(1) }),
  folderSchema,
  ['unknown-profile', 'invalid-path'],
  {
    valid: [{ profileId: 'p1', path: 'C:\\work\\repo-a' }],
    invalid: [null, {}, { profileId: 'p1' }, { profileId: '', path: 'C:\\work' }, { profileId: 'p1', path: '' }, { profileId: 'p1', path: 'C:\\work', extra: true }]
  }
)

export type AddFolderError = (typeof addFolder.errors)[number]
