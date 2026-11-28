import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { FolderStore } from '../folders.store'
import { removeFolder } from './remove.contract'
import { removeFolderController } from './remove.controller'

function setup() {
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  const { database } = opened.value
  for (const id of ['p1', 'p2']) database.prepare("INSERT INTO profiles (id, name, created_at) VALUES (?, ?, '2026-01-01')").run(id, id)
  const folder = database.prepare("INSERT INTO folders (id, profile_id, path, created_at) VALUES (?, ?, ?, '2026-01-01')")
  folder.run('used', 'p1', 'C:\\work\\a')
  folder.run('empty', 'p1', 'C:\\work\\b')
  // The same path in another profile: its session does not count for the folder of p1.
  folder.run('other', 'p2', 'C:\\work\\b')
  database
    .prepare("INSERT INTO sessions (id, profile_id, title, prompt, mode, source_path, model, created_at) VALUES ('s1', 'p1', 't', 't', 'ask', 'C:\\work\\a', 'default', '2026-01-01')")
    .run()
  database
    .prepare("INSERT INTO sessions (id, profile_id, title, prompt, mode, source_path, model, created_at) VALUES ('s2', 'p2', 't', 't', 'ask', 'C:\\work\\b', 'default', '2026-01-01')")
    .run()
  return { remove: removeFolderController(database), store: new FolderStore(database) }
}

describe('folders.remove', () => {
  it('removes a folder with no sessions and keeps the others', async () => {
    const { remove, store } = setup()
    const result = await remove({ folderId: 'empty' })
    expect(result).toEqual({ ok: true, value: {} })
    expect(removeFolder.output.safeParse(result).success).toBe(true)
    expect(store.listByProfile('p1').map((folder) => folder.id)).toEqual(['used'])
    expect(store.find('other')).not.toBeNull()
  })

  it('refuses a folder with a session of its profile, and keeps it', async () => {
    const { remove, store } = setup()
    const result = await remove({ folderId: 'used' })
    expect(result).toMatchObject({ ok: false, error: { code: 'folder-has-sessions' } })
    expect(removeFolder.output.safeParse(result).success).toBe(true)
    expect(store.find('used')).not.toBeNull()
    // The session of p2 uses the folder of p2.
    expect(await remove({ folderId: 'other' })).toMatchObject({ ok: false, error: { code: 'folder-has-sessions' } })
  })

  it('refuses a folder that does not exist', async () => {
    const { remove } = setup()
    expect(await remove({ folderId: 'missing' })).toMatchObject({ ok: false, error: { code: 'unknown-folder' } })
  })
})
