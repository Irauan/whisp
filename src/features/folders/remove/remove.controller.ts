import type { Database } from '../../../building-blocks/database'
import { FolderStore } from '../folders.store'
import { removeFolderHandler } from './remove.handler'

/** The input is already parsed against the contract. */
export const removeFolderController = (database: Database) => async (input: { folderId: string }) =>
  removeFolderHandler(new FolderStore(database), input)
