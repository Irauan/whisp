import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { SessionStore } from '../session.store'
import { Transcript } from '../transcript.store'
import { setMode } from './set-mode.contract'
import { setModeHandler } from './set-mode.handler'

function setup() {
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  const { database } = opened.value
  database.prepare("INSERT INTO profiles (id, name, created_at) VALUES ('p1', 'Personal', '2026-01-01')").run()
  database
    .prepare(
      "INSERT INTO sessions (id, profile_id, title, prompt, mode, source_path, model, created_at) VALUES ('s1', 'p1', 't', 'p', 'approve-all', 'C:\\work', 'default', '2026-01-01')"
    )
    .run()
  const store = new SessionStore(database)
  const transcript = new Transcript(store, () => undefined, { now: () => new Date('2026-01-02T00:00:00.000Z') }, { next: () => 'e1' })
  return { store, transcript, set: (id: string, mode: 'ask' | 'plan') => setModeHandler({ store, transcript }, { id, mode }) }
}

describe('sessions.set-mode', () => {
  it('saves the mode of a draft, also a lower one than the imported Approve all', () => {
    const { store, set } = setup()
    const result = set('s1', 'ask')
    expect(result).toEqual({ ok: true, value: {} })
    expect(setMode.output.safeParse(result).success).toBe(true)
    expect(store.find('s1')?.mode).toBe('ask')
  })

  it('refuses a session that does not exist', () => {
    const { set } = setup()
    expect(set('missing', 'ask')).toMatchObject({ ok: false, error: { code: 'unknown-session' } })
  })

  it('refuses a session that has an entry', () => {
    const { store, transcript, set } = setup()
    transcript.addEntry('s1', { kind: 'user', text: 'Say hello' })
    const result = set('s1', 'ask')
    expect(result).toMatchObject({ ok: false, error: { code: 'session-started' } })
    expect(setMode.output.safeParse(result).success).toBe(true)
    expect(store.find('s1')?.mode).toBe('approve-all')
  })

  it('refuses a session that has an agent session, and a session with a turn', () => {
    const { store, transcript, set } = setup()
    transcript.setStatus('s1', 'starting')
    expect(set('s1', 'plan')).toMatchObject({ ok: false, error: { code: 'session-started' } })
    transcript.setStatus('s1', 'idle')
    store.ensureProvider('p1', 'claude-code', 'v1', '2026-01-02')
    store.saveFirstStart('s1', { providerId: 'v1', snapshot: {}, agentSessionId: 'a1' })
    expect(set('s1', 'plan')).toMatchObject({ ok: false, error: { code: 'session-started' } })
    expect(store.find('s1')?.mode).toBe('approve-all')
  })
})
