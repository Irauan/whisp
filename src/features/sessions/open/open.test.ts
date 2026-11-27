import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { openSession } from './open.contract'
import { openSessionController } from './open.controller'

function setup() {
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  const { database } = opened.value
  database.prepare("INSERT INTO profiles (id, name, created_at) VALUES ('w1', 'Personal', '2026-01-01')").run()
  database
    .prepare(
      `INSERT INTO sessions (id, profile_id, title, prompt, mode, source_path, model, attachments, created_at)
       VALUES ('s1', 'w1', 'Fix the login page', 'Fix the login page\nThen test it.', 'auto', 'C:\\work', 'default', '[]', '2026-01-01')`
    )
    .run()
  return { open: openSessionController(database) }
}

describe('sessions.open', () => {
  it('returns the saved session with its prompt and its mode', async () => {
    const { open } = setup()
    const result = await open({ id: 's1' })
    expect(result).toEqual({
      ok: true,
      value: {
        session: {
          id: 's1',
          profileId: 'w1',
          title: 'Fix the login page',
          prompt: 'Fix the login page\nThen test it.',
          mode: 'auto',
          providerId: null,
          sourcePath: 'C:\\work',
          model: 'default',
          attachments: [],
          createdAt: '2026-01-01'
        }
      }
    })
    expect(openSession.output.safeParse(result).success).toBe(true)
  })

  it('refuses a session that does not exist', async () => {
    const { open } = setup()
    const result = await open({ id: 'missing' })
    expect(result).toMatchObject({ ok: false, error: { code: 'unknown-session' } })
    expect(openSession.output.safeParse(result).success).toBe(true)
  })
})
