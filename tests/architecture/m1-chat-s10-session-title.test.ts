// Story S10 of milestone m1-chat (session title from Claude): the unit checks S10-4, S10-5, S10-6,
// S10-8 and S10-16. Spec: `docs/milestones/m1-chat/stories/s10-session-title.md`, "Checks" (level
// "Unit"). The checks S10-7 and S10-9 need an agent process: they are in
// `m1-chat-s10-title-agent.test.ts`.
//
// Coordinator decision (S5 and S9 precedent): the locked unit checks of a story run as vitest tests
// in this folder, because `tsconfig.main.json` typechecks it.
//
// The interface that this test reads. Each name comes from the spec, "Interfaces" and "Data":
// - The port update `{ type: 'title'; title: string }` of `AgentUpdate`.
// - The slice `record-agent-update`: `recordAgentUpdateHandler(deps, { sessionId, update })` with
//   the deps `{ transcript, store }`. A dep that S10 adds must be optional (spec; the locked S9 test
//   `m1-chat-s9-retire-idle.test.ts` calls it with `{ transcript, store }` only). For the update
//   `title`, it cleans the title with `titleOf`, saves it in the store, then sends a session event
//   through the transcript.
// - The session event (`entry.ts`, `changeSchema`): the change `{ type: 'title'; title: string }`.
// - The window state (`src/renderer/src/session-view.ts`): the change `title` sets
//   `view.session.title`.
// - Migration 005: `sessions.title_source TEXT NOT NULL DEFAULT 'prompt'`, with no CHECK
//   (coordinator decision, 2026-11-28, user preference 5: a rule in code, not in the database). The
//   store validates the value in code ('prompt' | 'agent' | 'user') and refuses another value.
// - The store method that sets the title (spec, "Interfaces": "like setModel"). This test fixes its
//   name and its parameters: `SessionStore.setTitle(id, title, source)`, with the source `agent` or
//   `user`. It returns true when it saved the title, and false for an unknown session. For a bad
//   source it refuses: it throws or returns false, and it writes nothing.
//
// Readings of the spec text:
// - "No event goes out" (S10-4, S10-6): the transcript publishes no event at all for the update.
// - "No write" (S10-6): no session row comes back, and no other session changes.
// - A deleted session is removed from the store and forgotten by the transcript, as the composition
//   root does (`release` in `src/app/main/composition.ts`). An unknown session ("Error and empty
//   states") was never in the store and the transcript was never told.
//
// The typecheck must pass while the story is not built, so the test gives the update `title` and
// the change `title` as values of its own types, and it loads the renderer module at run time.
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentUpdate } from '../../src/building-blocks/agent.port'
import type { Clock } from '../../src/building-blocks/clock.port'
import { openDatabase, type Database } from '../../src/building-blocks/database'
import { MIGRATIONS } from '../../src/building-blocks/migrations'
import { createSessionHandler } from '../../src/features/sessions/create/create.handler'
import { sessionEventSchema, type SessionEvent } from '../../src/features/sessions/entry'
import { recordAgentUpdateHandler } from '../../src/features/sessions/record-agent-update/record-agent-update.handler'
import { SessionStore } from '../../src/features/sessions/session.store'
import { Transcript } from '../../src/features/sessions/transcript.store'

const ROOT = resolve(__dirname, '../..')
const SESSION_VIEW = 'src/renderer/src/session-view.ts'

/** The title limit of `titleOf` (`TITLE_LIMIT` in `src/features/sessions/session.ts`). */
const TITLE_LIMIT = 100

/** The update `title` of the port, as the spec gives it. */
const titleUpdate = (title: string) => ({ type: 'title', title }) as unknown as AgentUpdate

const fixedClock: Clock = { now: () => new Date('2026-03-01T09:00:00.000Z') }

interface Unit {
  folder: string
  database: Database
  store: SessionStore
  transcript: Transcript
  published: SessionEvent[]
  /** Creates a session with this first message and returns its ID. */
  create(prompt: string): string
  /** Gives one update of the agent to the slice. */
  record(sessionId: string, update: AgentUpdate): void
  /** The published events of one session. */
  eventsOf(sessionId: string): SessionEvent[]
}

let unit: Unit

beforeEach(async () => {
  const folder = await mkdtemp(join(tmpdir(), 'aether-s10-unit-'))
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  const { database } = opened.value
  // A profile with no GitHub account. All data is fake.
  database.prepare('INSERT INTO profiles (id, name, github_login, created_at) VALUES (?, ?, ?, ?)').run('p1', 'Personal', null, '2026-01-01')
  const store = new SessionStore(database)
  let count = 0
  const ids = { next: () => `id${++count}` }
  const published: SessionEvent[] = []
  const transcript = new Transcript(store, (event) => published.push(event), fixedClock, ids)
  unit = {
    folder,
    database,
    store,
    transcript,
    published,
    create: (prompt) => {
      const created = createSessionHandler(
        { store, clock: fixedClock, ids },
        { profileId: 'p1', prompt, mode: 'ask', model: 'default', sourcePath: folder, attachments: [] }
      )
      if (!created.ok) throw new Error(`The session was not created: ${created.error.message}`)
      return created.value.id
    },
    record: (sessionId, update) => recordAgentUpdateHandler({ transcript, store }, { sessionId, update }),
    eventsOf: (sessionId) => published.filter((event) => event.sessionId === sessionId)
  }
})

afterEach(async () => {
  unit.database.close()
  await rm(unit.folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

const titleOfRow = (sessionId: string) => unit.store.find(sessionId)?.title
const sessionCount = () => (unit.database.prepare('SELECT COUNT(*) AS count FROM sessions').get() as { count: number }).count

/** Gives the title to the slice, and checks that it saves the title and sends one event `title`. */
function expectSaved(sessionId: string, reported: string, saved: string, check: string): void {
  const before = unit.eventsOf(sessionId).length
  unit.record(sessionId, titleUpdate(reported))
  expect(titleOfRow(sessionId), `${check}: the agent reported the title ${JSON.stringify(reported)}, but the store does not hold the title ${JSON.stringify(saved)}.`).toBe(saved)
  const events = unit.eventsOf(sessionId).slice(before)
  expect(
    events.map((event) => event.change),
    `${check}: the title ${JSON.stringify(reported)} must send exactly one session event { type: 'title', title: ${JSON.stringify(saved)} }.`
  ).toEqual([{ type: 'title', title: saved }])
}

describe('S10-4: a blank title, a title with a blank first line, or the saved title changes nothing', () => {
  it('S10-4: after the title "Greeting test", the titles "", "   ", "\\nGreeting", "Greeting test" and "  Greeting test  " change no title and send no event', () => {
    const check = 'S10-4'
    const id = unit.create('Say hello')
    expect(titleOfRow(id), `${check}: the first line of the first message must be the title before the agent sends one.`).toBe('Say hello')

    // A first title changes the title. The cases below must then change nothing.
    expectSaved(id, 'Greeting test', 'Greeting test', check)
    const before = unit.published.length
    for (const reported of ['', '   ', '\nGreeting', '\r\nGreeting', 'Greeting test', '  Greeting test  ']) {
      unit.record(id, titleUpdate(reported))
      expect(titleOfRow(id), `${check}: the title ${JSON.stringify(reported)} changed the saved title.`).toBe('Greeting test')
      expect(unit.published.slice(before), `${check}: the title ${JSON.stringify(reported)} sent an event.`).toEqual([])
    }
  })
})

describe('S10-5: the saved title is the first line, cut at the title limit', () => {
  it('S10-5: a title with two lines and 150 characters on the first line saves the first 100 characters of the first line', () => {
    const check = 'S10-5'
    const id = unit.create('Say hello')
    const firstLine = `Fix the ${'x'.repeat(142)}`
    expect([...firstLine], 'The first line of this test must have 150 characters.').toHaveLength(150)
    expectSaved(id, `${firstLine}\nThe second line of the title.`, firstLine.slice(0, TITLE_LIMIT), check)
  })
})

describe('S10-6: a title for a deleted session changes nothing', () => {
  it('S10-6: a title for a deleted session, or for an unknown session, writes nothing and sends no event, while a title for a live session works', () => {
    const check = 'S10-6'
    const live = unit.create('Say hello')
    const deleted = unit.create('Write the notes')
    // A title for a live session works, so the cases below test the guard, not a missing feature.
    expectSaved(live, 'Greeting test', 'Greeting test', check)

    // The deletion, as the composition root does it: the row goes, and the transcript forgets the session.
    expect(unit.store.remove(deleted), `${check}: the session to delete was not in the store.`).toBe(true)
    unit.transcript.forget(deleted)
    const rows = sessionCount()
    const before = unit.published.length

    for (const sessionId of [deleted, 'unknown-session']) {
      expect(() => unit.record(sessionId, titleUpdate('Late title')), `${check}: a title for the session ${sessionId} threw.`).not.toThrow()
      expect(unit.store.find(sessionId), `${check}: a title for the session ${sessionId} wrote a session row.`).toBeNull()
      expect(sessionCount(), `${check}: a title for the session ${sessionId} changed the number of session rows.`).toBe(rows)
      expect(unit.published.slice(before), `${check}: a title for the session ${sessionId} sent an event.`).toEqual([])
    }
    expect(titleOfRow(live), `${check}: a title for another session changed the live session.`).toBe('Greeting test')
  })
})

// S10-8: the window state.

/** The members of `session-view.ts` that this test reads. */
interface SessionView {
  emptyWindowState: unknown
  reduceSessionWindow(state: unknown, action: unknown): { view: { session?: { title?: unknown }; revision?: unknown } | null; needsSnapshot: boolean }
}

async function loadSessionView(check: string): Promise<SessionView> {
  if (!existsSync(join(ROOT, SESSION_VIEW))) throw new Error(`${check}: ${SESSION_VIEW} is missing.`)
  const module = (await import(join(ROOT, SESSION_VIEW))) as Partial<SessionView>
  if (typeof module.reduceSessionWindow !== 'function') throw new Error(`${check}: ${SESSION_VIEW} exports no function reduceSessionWindow.`)
  return module as SessionView
}

describe('S10-8: the window state takes the title change', () => {
  it('S10-8: an event with the change title sets view.session.title, and the event passes the schema of sessions.changed', async () => {
    const check = 'S10-8'
    const { emptyWindowState, reduceSessionWindow } = await loadSessionView(check)
    const session = {
      id: 's1',
      profileId: 'p1',
      title: 'Say hello',
      prompt: 'Say hello',
      mode: 'ask',
      providerId: null,
      sourcePath: 'C:\\work',
      model: 'default',
      attachments: [],
      createdAt: '2026-01-01'
    }
    const snapshot = { session, entries: [], status: 'idle', revision: 3, draft: false, permissions: [], elicitations: [], liveMode: null }
    const event = { sessionId: 's1', revision: 4, change: { type: 'title', title: 'Greeting test' } }

    // The window reads each event through the schema of `sessions.changed` (`useSession.ts`).
    const parsed = sessionEventSchema.safeParse(event)
    expect(parsed.success, `${check}: the schema of sessions.changed refuses the change { type: 'title', title }: ${parsed.error?.message ?? ''}`).toBe(true)

    const loaded = reduceSessionWindow(emptyWindowState, { type: 'snapshot', snapshot })
    const next = reduceSessionWindow(loaded, { type: 'event', event })
    expect(next.needsSnapshot, `${check}: the window state did not fit the change title, so it asks for a new snapshot.`).toBe(false)
    expect(next.view?.session?.title, `${check}: after the change title, view.session.title must be the new title.`).toBe('Greeting test')
    expect(next.view?.revision, `${check}: the window state must take the revision of the event.`).toBe(4)
    expect(next.view?.session, `${check}: the change title must change only the title of the session.`).toEqual({ ...session, title: 'Greeting test' })
  })
})

/** The store method that sets the title, as the header gives it. */
type SetTitle = (id: string, title: string, source: string) => boolean

describe('S10-16: migration 005 adds the source of the title', () => {
  it("S10-16: a database at version 4 with sessions gets title_source 'prompt' for each session, and the store refuses a bad value", async () => {
    const check = 'S10-16'
    const folder = await mkdtemp(join(tmpdir(), 'aether-s10-migration-'))
    try {
      const path = join(folder, 'aether.db')
      const first = openDatabase(path, MIGRATIONS.slice(0, 4))
      if (!first.ok) throw new Error(first.error.message)
      const old = first.value.database
      expect(old.prepare('PRAGMA user_version').get(), `${check}: the first open must give a database at version 4.`).toEqual({ user_version: 4 })
      old.prepare("INSERT INTO profiles (id, name, created_at) VALUES ('p1', 'Personal', '2026-01-01')").run()
      const insert = old.prepare(
        "INSERT INTO sessions (id, profile_id, title, prompt, mode, source_path, model, created_at) VALUES (?, 'p1', ?, ?, 'ask', 'f', 'default', '2026-01-02')"
      )
      insert.run('s1', 'Say hello', 'Say hello')
      insert.run('s2', 'Write the notes', 'Write the notes\nThen list them.')
      old.close()

      expect(MIGRATIONS.map((migration) => migration.version), `${check}: the product has no migration 005.`).toContain(5)
      const second = openDatabase(path, MIGRATIONS)
      if (!second.ok) throw new Error(`${check}: the migration from version 4 failed: ${second.error.message}`)
      const { database } = second.value
      try {
        expect(
          (database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
          `${check}: the database must reach version 5 or later.`
        ).toBeGreaterThanOrEqual(5)
        let rows: unknown[]
        try {
          rows = database.prepare('SELECT id, title, title_source FROM sessions ORDER BY id').all()
        } catch (error) {
          throw new Error(`${check}: the table sessions has no column title_source after the migration: ${String(error)}`)
        }
        expect(rows, `${check}: each earlier session must get title_source 'prompt', and keep its title.`).toEqual([
          { id: 's1', title: 'Say hello', title_source: 'prompt' },
          { id: 's2', title: 'Write the notes', title_source: 'prompt' }
        ])

        // A new row gets the default. The column is NOT NULL.
        database
          .prepare("INSERT INTO sessions (id, profile_id, title, prompt, mode, source_path, model, created_at) VALUES ('s3', 'p1', 't', 'p', 'ask', 'f', 'default', '2026-01-03')")
          .run()
        expect(database.prepare("SELECT title_source FROM sessions WHERE id = 's3'").get(), `${check}: a new session must get title_source 'prompt'.`).toEqual({
          title_source: 'prompt'
        })
        expect(
          () => database.prepare("UPDATE sessions SET title_source = NULL WHERE id = 's3'").run(),
          `${check}: title_source must be NOT NULL.`
        ).toThrow()

        // No CHECK lists the values: the code validates them (coordinator decision, user preference 5).
        expect(
          () => database.prepare("UPDATE sessions SET title_source = 'robot' WHERE id = 's3'").run(),
          `${check}: the database must not list the values of title_source in a CHECK. The store validates them.`
        ).not.toThrow()

        // The store saves a title with a source of the spec.
        const store = new SessionStore(database)
        const setTitle = (store as unknown as { setTitle?: unknown }).setTitle
        if (typeof setTitle !== 'function') throw new Error(`${check}: SessionStore has no method setTitle(id, title, source).`)
        const set = (setTitle as SetTitle).bind(store)
        const sourceOf = (id: string) => database.prepare('SELECT title, title_source FROM sessions WHERE id = ?').get(id)
        expect(set('s1', 'Greeting test', 'user'), `${check}: setTitle with the source 'user' must save the title.`).toBe(true)
        expect(sourceOf('s1'), `${check}: setTitle with the source 'user' must save the title and the source.`).toEqual({
          title: 'Greeting test',
          title_source: 'user'
        })
        expect(set('s2', 'Release notes', 'agent'), `${check}: setTitle with the source 'agent' must save the title.`).toBe(true)
        expect(sourceOf('s2'), `${check}: setTitle with the source 'agent' must save the title and the source.`).toEqual({
          title: 'Release notes',
          title_source: 'agent'
        })

        // The store refuses a bad value: it throws or returns false, and it writes nothing.
        for (const bad of ['robot', '', 'User']) {
          let saved: boolean | 'threw'
          try {
            saved = set('s1', 'Other title', bad)
          } catch {
            saved = 'threw'
          }
          expect(saved, `${check}: the store must refuse the source '${bad}': setTitle must throw or return false.`).not.toBe(true)
          expect(sourceOf('s1'), `${check}: the refused source '${bad}' changed the row.`).toEqual({ title: 'Greeting test', title_source: 'user' })
        }
      } finally {
        database.close()
      }
    } finally {
      await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
  })
})
