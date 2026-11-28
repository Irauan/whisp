import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import type { SessionEvent } from '../entry'
import { SessionStore } from '../session.store'
import { Transcript } from '../transcript.store'
import { renameSession } from './rename.contract'
import { renameSessionHandler } from './rename.handler'

function setup(started = true) {
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  const { database } = opened.value
  database.prepare("INSERT INTO profiles (id, name, created_at) VALUES ('p1', 'Personal', '2026-01-01')").run()
  database
    .prepare(
      "INSERT INTO sessions (id, profile_id, title, prompt, mode, source_path, model, created_at) VALUES ('s1', 'p1', 'Say hello', 'Say hello', 'ask', 'C:\\work', 'default', '2026-01-01')"
    )
    .run()
  const store = new SessionStore(database)
  // A started session has its first message. Without it the session is a draft.
  if (started) store.insertEntry('s1', { id: 'u1', entry: { kind: 'user', text: 'Say hello' } }, 0, '2026-01-01')
  const events: SessionEvent[] = []
  const transcript = new Transcript(store, (event) => events.push(event), { now: () => new Date('2026-01-02T00:00:00.000Z') }, { next: () => 'e1' })
  return { store, events, rename: (id: string, title: string) => renameSessionHandler({ store, transcript }, { id, title }) }
}

describe('sessions.rename (S10-14)', () => {
  it('cleans the title, saves it with the source user, then tells the window', () => {
    const { store, events, rename } = setup()
    const result = rename('s1', '  My name  \nignored')
    expect(result).toEqual({ ok: true, value: {} })
    expect(renameSession.output.safeParse(result).success).toBe(true)
    expect(store.find('s1')?.title).toBe('My name')
    expect(store.titleSourceOf('s1')).toBe('user')
    expect(events.map((event) => event.change)).toEqual([{ type: 'title', title: 'My name' }])
  })

  it('refuses a blank title, and changes nothing', () => {
    const { store, events, rename } = setup()
    expect(rename('s1', '   ')).toMatchObject({ ok: false, error: { code: 'blank-title' } })
    expect(rename('s1', '\nSecond line')).toMatchObject({ ok: false, error: { code: 'blank-title' } })
    expect(store.find('s1')?.title).toBe('Say hello')
    expect(store.titleSourceOf('s1')).toBe('prompt')
    expect(events).toEqual([])
  })

  it('refuses a draft, and changes nothing', () => {
    const { store, events, rename } = setup(false)
    expect(rename('s1', 'My name')).toMatchObject({ ok: false, error: { code: 'draft' } })
    expect(store.find('s1')?.title).toBe('Say hello')
    expect(store.titleSourceOf('s1')).toBe('prompt')
    expect(events).toEqual([])
  })

  it('refuses a session that does not exist', () => {
    const { rename } = setup()
    expect(rename('missing', 'My name')).toMatchObject({ ok: false, error: { code: 'unknown-session' } })
  })

  it('sets the source but sends no event when the title does not change', () => {
    const { store, events, rename } = setup()
    expect(rename('s1', 'Say hello')).toEqual({ ok: true, value: {} })
    expect(store.titleSourceOf('s1')).toBe('user')
    expect(events).toEqual([])
  })

  it('sends no event when the save fails', () => {
    const { store, events, rename } = setup()
    store.setTitle = () => {
      throw new Error('disk full')
    }
    expect(() => rename('s1', 'My name')).toThrow('disk full')
    expect(events).toEqual([])
  })
})
