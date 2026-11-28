import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'

/**
 * Removes a folder from the sidebar. Only a folder with no sessions can go. The folder on the disk
 * stays as it is.
 */
export const removeFolder = defineContract(
  'folders.remove',
  z.strictObject({ folderId: z.string().min(1) }),
  z.strictObject({}),
  ['unknown-folder', 'folder-has-sessions'],
  {
    valid: [{ folderId: 'f1' }],
    invalid: [null, {}, { folderId: '' }, { folderId: 1 }, { folderId: 'f1', extra: true }]
  }
)

export type RemoveFolderError = (typeof removeFolder.errors)[number]
