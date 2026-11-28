import { z } from 'zod'
import { defineContract } from '../../../building-blocks/contract'

/** Saves whether the group of a folder is collapsed in the sidebar. It survives a restart. */
export const setFolderCollapsed = defineContract(
  'folders.set-collapsed',
  z.strictObject({ folderId: z.string().min(1), collapsed: z.boolean() }),
  z.strictObject({}),
  ['unknown-folder'],
  {
    valid: [{ folderId: 'f1', collapsed: true }, { folderId: 'f1', collapsed: false }],
    invalid: [null, {}, { folderId: 'f1' }, { folderId: '', collapsed: true }, { folderId: 'f1', collapsed: 1 }, { folderId: 'f1', collapsed: true, extra: true }]
  }
)

export type SetFolderCollapsedError = (typeof setFolderCollapsed.errors)[number]
