import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { FolderStore } from '../folders.store'
import { setFolderCollapsed } from './set-collapsed.contract'
import { setFolderCollapsedController } from './set-collapsed.controller'

function setup() {
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  const { database } = opened.value
  database.prepare("INSERT INTO profiles (id, name, created_at) VALUES ('p1', 'Personal', '2026-01-01')").run()
  database.prepare("INSERT INTO folders (id, profile_id, path, created_at) VALUES ('f1', 'p1', 'C:\\work\\a', '2026-01-01')").run()
  database.prepare("INSERT INTO folders (id, profile_id, path, created_at) VALUES ('f2', 'p1', 'C:\\work\\b', '2026-01-01')").run()
  return { change: setFolderCollapsedController(database), store: new FolderStore(database) }
}

describe('folders.set-collapsed', () => {
  it('saves the state of one folder and leaves the others', async () => {
    const { change, store } = setup()
    const result = await change({ folderId: 'f1', collapsed: true })
    expect(result).toEqual({ ok: true, value: {} })
    expect(setFolderCollapsed.output.safeParse(result).success).toBe(true)
    expect(store.listByProfile('p1').map((folder) => folder.collapsed)).toEqual([true, false])
    await change({ folderId: 'f1', collapsed: false })
    expect(store.find('f1')?.collapsed).toBe(false)
  })

  it('refuses a folder that does not exist', async () => {
    const { change } = setup()
    const result = await change({ folderId: 'missing', collapsed: true })
    expect(result).toMatchObject({ ok: false, error: { code: 'unknown-folder' } })
    expect(setFolderCollapsed.output.safeParse(result).success).toBe(true)
  })
})
