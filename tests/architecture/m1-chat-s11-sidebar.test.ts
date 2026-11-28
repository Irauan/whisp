// Story S11 of milestone m1-chat (sidebar folders and session status): the unit checks of the
// renderer S11-17, S11-20 and S11-23. Spec: `docs/milestones/m1-chat/stories/s11-sidebar-status.md`,
// "Status icon of a session row", "Interfaces" (the sidebar map) and "Checks" (level "Unit").
//
// Coordinator decision (S5, S9 and S10 precedent): the locked unit checks of a story run as vitest
// tests in this folder, because `tsconfig.main.json` typechecks it. The typecheck must pass while the
// story is not built, so the test loads the renderer modules at run time and uses its own types (S10
// precedent, `m1-chat-s10-session-title.test.ts`).
//
// The interface that this test reads. The spec gives the rules but no module and no function names
// for S11-17 and S11-20, and the renderer has no DOM test library, so the rules must be pure
// functions. This test fixes the smallest interface:
// - `src/renderer/src/sidebar-state.ts` exports
//     sessionState(input: { status: 'idle' | 'starting' | 'working'; openCardIds: readonly string[];
//                           unread: boolean; asking: boolean }): 'Needs your answer' | 'Working' | 'New answer' | null
//   `asking` is true while the trust or the directory question of S6 waits for this session (open
//   choice 5, A). The result is the state text of the row (its accessible description), or null for
//   the normal state. The first matching state of the table wins.
// - The same module exports
//     applySidebarEvent(items: ReadonlyMap<string, Item>, event: SessionEvent): ReadonlyMap<string, Item> | null
//   `items` is the sidebar map of `App.tsx`, by session ID. An item has at least `id`, `status`,
//   `openCardIds`, `unread` and `revision`; the function keeps the other fields. It applies the
//   changes `status`, `card-opened`, `card-closed` and `unread` in the order of the revision. An event
//   at or below the revision of its item changes nothing. A gap returns null: the caller then calls
//   `reload()`.
// - `src/renderer/src/session-view.ts`: `reduceSessionWindow` and `emptyWindowState`, as today.
// - `changeSchema` of `src/features/sessions/entry.ts` has the change `{ type: 'unread'; unread: boolean }`.
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sessionEventSchema } from '../../src/features/sessions/entry'

const ROOT = resolve(__dirname, '../..')
const SIDEBAR_STATE = 'src/renderer/src/sidebar-state.ts'
const SESSION_VIEW = 'src/renderer/src/session-view.ts'

type Status = 'idle' | 'starting' | 'working'
type State = 'Needs your answer' | 'Working' | 'New answer' | null

interface Item {
  id: string
  title: string
  status: Status
  openCardIds: string[]
  unread: boolean
  revision: number
}

interface Event {
  sessionId: string
  revision: number
  change: Record<string, unknown> & { type: string }
}

interface SidebarState {
  sessionState(input: { status: Status; openCardIds: readonly string[]; unread: boolean; asking: boolean }): State
  applySidebarEvent(items: ReadonlyMap<string, Item>, event: Event): ReadonlyMap<string, Item> | null
}

async function loadSidebarState(check: string, name: keyof SidebarState): Promise<SidebarState> {
  if (!existsSync(join(ROOT, SIDEBAR_STATE))) throw new Error(`${check}: ${SIDEBAR_STATE} is missing.`)
  const module = (await import(join(ROOT, SIDEBAR_STATE))) as Partial<SidebarState>
  if (typeof module[name] !== 'function') throw new Error(`${check}: ${SIDEBAR_STATE} exports no function ${name}.`)
  return module as SidebarState
}

describe('S11-17: the status rule of a session row', () => {
  it('S11-17: for each combination of open cards, a question, the status and the unread mark, the first matching state of the table wins', async () => {
    const check = 'S11-17'
    const { sessionState } = await loadSidebarState(check, 'sessionState')
    const statuses: Status[] = ['idle', 'starting', 'working']
    for (const status of statuses) {
      for (const openCardIds of [[], ['card-1'], ['card-1', 'card-2']]) {
        for (const asking of [false, true]) {
          for (const unread of [false, true]) {
            const expected: State =
              openCardIds.length > 0 || asking ? 'Needs your answer' : status !== 'idle' ? 'Working' : unread ? 'New answer' : null
            const input = { status, openCardIds, unread, asking }
            expect(sessionState(input), `${check}: the state of ${JSON.stringify(input)} must be ${JSON.stringify(expected)}.`).toBe(expected)
          }
        }
      }
    }
  })
})

describe('S11-20: the sidebar map applies the session events in the order of the revision', () => {
  const item: Item = { id: 's1', title: 'Fix the login page', status: 'idle', openCardIds: [], unread: false, revision: 5 }
  const other: Item = { id: 's2', title: 'Sort the notes', status: 'idle', openCardIds: [], unread: true, revision: 9 }
  const mapOf = (...items: Item[]) => new Map(items.map((entry) => [entry.id, entry]))
  const permissionEntry = { id: 'e1', entry: { kind: 'answers', answers: [] } }

  it('S11-20: an event at or below the revision of its item is dropped', async () => {
    const check = 'S11-20'
    const { applySidebarEvent } = await loadSidebarState(check, 'applySidebarEvent')
    for (const revision of [5, 4, 1]) {
      for (const change of [
        { type: 'status', status: 'working' },
        { type: 'unread', unread: true },
        { type: 'card-opened', entry: permissionEntry, card: { kind: 'permission', permission: { id: 'card-1' } } }
      ]) {
        const items = mapOf(item, other)
        const result = applySidebarEvent(items, { sessionId: 's1', revision, change })
        expect(result, `${check}: an event at revision ${revision} (item at 5) must be dropped, not asked for a reload.`).not.toBeNull()
        expect(result, `${check}: the event ${JSON.stringify(change)} at revision ${revision} (item at 5) must change nothing.`).toEqual(mapOf(item, other))
      }
    }
  })

  it('S11-20: a gap in the revisions asks for a reload', async () => {
    const check = 'S11-20'
    const { applySidebarEvent } = await loadSidebarState(check, 'applySidebarEvent')
    for (const revision of [7, 20]) {
      const result = applySidebarEvent(mapOf(item, other), { sessionId: 's1', revision, change: { type: 'status', status: 'working' } })
      expect(result, `${check}: an event at revision ${revision} after the item revision 5 is a gap: the result must be null (a reload).`).toBeNull()
    }
  })

  it('S11-20: the next revision applies the changes status, card-opened, card-closed and unread, and keeps the open card IDs', async () => {
    const check = 'S11-20'
    const { applySidebarEvent } = await loadSidebarState(check, 'applySidebarEvent')
    const steps: [Event['change'], Partial<Item>][] = [
      [{ type: 'status', status: 'working' }, { status: 'working', revision: 6 }],
      [{ type: 'card-opened', entry: permissionEntry, card: { kind: 'permission', permission: { id: 'card-1' } } }, { openCardIds: ['card-1'], revision: 7 }],
      [{ type: 'card-opened', entry: { id: 'e2', entry: permissionEntry.entry }, card: { kind: 'elicitation', elicitation: { id: 'form-1' } } }, { openCardIds: ['card-1', 'form-1'], revision: 8 }],
      [{ type: 'card-closed', entry: permissionEntry, id: 'card-1' }, { openCardIds: ['form-1'], revision: 9 }],
      [{ type: 'status', status: 'idle' }, { status: 'idle', revision: 10 }],
      [{ type: 'unread', unread: true }, { unread: true, revision: 11 }]
    ]
    let items: ReadonlyMap<string, Item> = mapOf(item, other)
    for (const [index, [change, expected]] of steps.entries()) {
      const next = applySidebarEvent(items, { sessionId: 's1', revision: 6 + index, change })
      if (next === null) throw new Error(`${check}: the event ${JSON.stringify(change)} at the next revision ${6 + index} asked for a reload.`)
      expect(next.get('s1'), `${check}: the event ${JSON.stringify(change)} at revision ${6 + index} must apply.`).toMatchObject({ ...expected, title: item.title })
      expect(next.get('s2'), `${check}: an event of s1 must not change s2.`).toEqual(other)
      items = next
    }
  })
})

describe('S11-23: the window state takes the change unread', () => {
  interface SessionView {
    emptyWindowState: unknown
    reduceSessionWindow(state: unknown, action: unknown): { view: Record<string, unknown> | null; needsSnapshot: boolean }
  }

  it('S11-23: an event with the change unread moves the revision on and changes nothing else', async () => {
    const check = 'S11-23'
    const event = { sessionId: 's1', revision: 4, change: { type: 'unread', unread: true } }
    const parsed = sessionEventSchema.safeParse(event)
    expect(parsed.success, `${check}: the schema of sessions.changed refuses the change { type: 'unread', unread: true }: ${parsed.error?.message ?? ''}`).toBe(true)

    if (!existsSync(join(ROOT, SESSION_VIEW))) throw new Error(`${check}: ${SESSION_VIEW} is missing.`)
    const { emptyWindowState, reduceSessionWindow } = (await import(join(ROOT, SESSION_VIEW))) as SessionView
    const session = {
      id: 's1',
      profileId: 'p1',
      title: 'Fix the login page',
      prompt: 'Fix the login page',
      mode: 'ask',
      providerId: null,
      sourcePath: 'C:\\work',
      model: 'default',
      attachments: [],
      createdAt: '2026-01-01'
    }
    const snapshot = { session, entries: [], status: 'idle', revision: 3, draft: false, permissions: [], elicitations: [], liveMode: null }
    const loaded = reduceSessionWindow(emptyWindowState, { type: 'snapshot', snapshot })
    const next = reduceSessionWindow(loaded, { type: 'event', event: parsed.success ? parsed.data : event })
    expect(next.needsSnapshot, `${check}: the window state did not fit the change unread, so it asks for a new snapshot.`).toBe(false)
    expect(next.view, `${check}: the change unread must move the revision to 4 and change nothing else.`).toEqual({ ...snapshot, revision: 4 })
  })
})
