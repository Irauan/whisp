import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { SessionStore } from '../session.store'
import { Transcript } from '../transcript.store'
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
  const store = new SessionStore(database)
  let count = 0
  const transcript = new Transcript(store, () => undefined, { now: () => new Date('2026-01-02T00:00:00.000Z') }, { next: () => `e${++count}` })
  return { store, transcript, open: openSessionController(database, transcript) }
}

const session = {
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

describe('sessions.open', () => {
  it('returns the saved draft with its prompt and its mode, and no entry', async () => {
    const { open } = setup()
    const result = await open({ id: 's1' })
    expect(result).toEqual({ ok: true, value: { session, entries: [], status: 'idle', revision: 0, draft: true } })
    expect(openSession.output.safeParse(result).success).toBe(true)
  })

  it('returns the entries in order, the open text, the status and the revision of the snapshot', async () => {
    const { transcript, open } = setup()
    transcript.addEntry('s1', { kind: 'user', text: 'Say hello' })
    transcript.setStatus('s1', 'working')
    transcript.addText('s1', 'agent', 'Hello ')
    transcript.addText('s1', 'agent', 'there.')
    const result = await open({ id: 's1' })
    expect(result).toEqual({
      ok: true,
      value: {
        session,
        entries: [
          { id: 'e1', entry: { kind: 'user', text: 'Say hello' } },
          { id: 'e2', entry: { kind: 'agent', text: 'Hello there.' } }
        ],
        status: 'working',
        revision: 4,
        draft: false
      }
    })
    expect(openSession.output.safeParse(result).success).toBe(true)
  })

  it('returns the saved entries of a session after a restart, with the status Idle', async () => {
    const { store, open } = setup()
    store.insertEntry('s1', { id: 'a', entry: { kind: 'user', text: 'Say hello' } }, 0, '2026-01-02')
    store.insertEntry('s1', { id: 'b', entry: { kind: 'plan', steps: [{ text: 'One', status: 'completed' }, { text: 'Two', status: 'in_progress' }] } }, 1, '2026-01-02')
    const result = await open({ id: 's1' })
    expect(result).toMatchObject({
      ok: true,
      value: {
        entries: [
          { id: 'a', entry: { kind: 'user', text: 'Say hello' } },
          { id: 'b', entry: { kind: 'plan', steps: [{ text: 'One', status: 'completed' }, { text: 'Two', status: 'in_progress' }] } }
        ],
        status: 'idle',
        revision: 0,
        draft: false
      }
    })
  })

  it('refuses a session that does not exist', async () => {
    const { open } = setup()
    const result = await open({ id: 'missing' })
    expect(result).toMatchObject({ ok: false, error: { code: 'unknown-session' } })
    expect(openSession.output.safeParse(result).success).toBe(true)
  })
})
