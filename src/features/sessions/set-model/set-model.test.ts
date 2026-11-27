import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { SessionStore } from '../session.store'
import { Transcript } from '../transcript.store'
import { setModel } from './set-model.contract'
import { setModelHandler } from './set-model.handler'

function setup() {
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  const { database } = opened.value
  database.prepare("INSERT INTO profiles (id, name, created_at) VALUES ('p1', 'Personal', '2026-01-01')").run()
  database
    .prepare(
      "INSERT INTO sessions (id, profile_id, title, prompt, mode, source_path, model, created_at) VALUES ('s1', 'p1', 't', 'p', 'ask', 'C:\\work', 'default', '2026-01-01')"
    )
    .run()
  const store = new SessionStore(database)
  const transcript = new Transcript(store, () => undefined, { now: () => new Date('2026-01-02T00:00:00.000Z') }, { next: () => 'e1' })
  return { store, transcript, set: (id: string, model: string) => setModelHandler({ store, transcript }, { id, model }) }
}

describe('sessions.set-model (S8-7)', () => {
  it('saves the model of a draft, also a model that is not in the list of the renderer', () => {
    const { store, set } = setup()
    const result = set('s1', 'claude-opus-5-5')
    expect(result).toEqual({ ok: true, value: {} })
    expect(setModel.output.safeParse(result).success).toBe(true)
    expect(store.find('s1')?.model).toBe('claude-opus-5-5')
    expect(set('s1', 'a-model-that-a-fallback-names')).toEqual({ ok: true, value: {} })
    expect(store.find('s1')?.model).toBe('a-model-that-a-fallback-names')
  })

  it('refuses a session that does not exist', () => {
    const { set } = setup()
    expect(set('missing', 'default')).toMatchObject({ ok: false, error: { code: 'unknown-session' } })
  })

  it('answers session-started for a session that has an entry, and keeps the saved model', () => {
    const { store, transcript, set } = setup()
    transcript.addEntry('s1', { kind: 'user', text: 'Say hello' })
    const result = set('s1', 'claude-opus-5-5')
    expect(result).toMatchObject({ ok: false, error: { code: 'session-started' } })
    expect(setModel.output.safeParse(result).success).toBe(true)
    expect(store.find('s1')?.model).toBe('default')
  })

  it('answers session-started for a session with a turn and for a session with an agent session', () => {
    const { store, transcript, set } = setup()
    transcript.setStatus('s1', 'starting')
    expect(set('s1', 'claude-opus-5-5')).toMatchObject({ ok: false, error: { code: 'session-started' } })
    transcript.setStatus('s1', 'idle')
    store.ensureCurrentProvider('p1', 'claude-code', 'v1', '2026-01-02')
    store.saveFirstRun('s1', { id: 'r1', providerId: 'v1', externalId: 'a1', createdAt: '2026-01-02' })
    expect(set('s1', 'claude-opus-5-5')).toMatchObject({ ok: false, error: { code: 'session-started' } })
    expect(store.find('s1')?.model).toBe('default')
  })
})
