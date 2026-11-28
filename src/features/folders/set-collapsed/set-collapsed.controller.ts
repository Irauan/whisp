import type { Database } from '../../../building-blocks/database'
import { FolderStore } from '../folders.store'
import { setFolderCollapsedHandler } from './set-collapsed.handler'

/** The input is already parsed against the contract. */
export const setFolderCollapsedController = (database: Database) => async (input: { folderId: string; collapsed: boolean }) =>
  setFolderCollapsedHandler(new FolderStore(database), input)
