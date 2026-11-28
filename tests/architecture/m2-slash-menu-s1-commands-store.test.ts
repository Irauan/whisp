// Story S1 of milestone m2-slash-menu (slash menu): the unit check S1-6 of the commands store. Spec:
// `docs/milestones/m2-slash-menu/stories/s1-slash-menu.md`, "Behavior" rules 4 to 7, "Interfaces"
// (Store: `src/features/sessions/commands.store.ts`, in memory: `set(owner, pairKey, commands)`,
// `state(owner, state)`, `of(owner)`, `lastOf(pairKey)`) and "Checks".
//
// S1-6: a list for session A with the pair P. The process of A is released. Session B starts with
//       the pair P. A is `no-agent` and returns the list of P. B is `loading` and returns the list
//       of P.
//
// The interface that this test reads. The spec gives the module and the four method names. This
// test fixes the smallest missing parts (test author, 2026-11-28; advisor: not hard to revert):
// - The module exports a class whose instances have the methods `set`, `state`, `of` and `lastOf`.
//   The test finds it by these methods, not by its name. Its constructor takes at most one
//   argument: a function that gets each change (the event `sessions.commands-changed`, rule 8).
//   This test passes a function that does nothing.
// - An owner is `{ sessionId: string }`, as the owner of the event `sessions.commands-changed`.
// - A pair key is a string that the start path makes from the provider account ID and the folder.
//   The store does not read it.
// - `state(owner, state, pairKey?)`: the start path gives the pair key with `loading` (spec,
//   "Interfaces": "it sets `loading` and the pair key when a process starts"). `set(owner, pairKey,
//   commands)` keeps the list of the owner and the last list of the pair, and makes the owner
//   `ready` (rule 6: its process sent a list).
// - `of(owner)` returns `{ state, commands }`, the result of the query `sessions.list-commands`
//   (rule 7). `lastOf(pairKey)` returns the last list of the pair.
// - A command is `AgentCommand`: `{ name, description, hint }`.
//
// Coordinator decision (S5, S9, S10 and S11 precedent of m1-chat): these locked unit checks run as
// vitest tests in this folder. The typecheck must pass while the story is not built, so the test
// loads the module at run time and uses its own types.
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../..')
const STORE = 'src/features/sessions/commands.store.ts'

interface AgentCommand {
  name: string
  description: string
  hint: string
}
type State = 'loading' | 'ready' | 'no-agent'
interface Owner {
  sessionId: string
}
interface CommandsStore {
  set(owner: Owner, pairKey: string, commands: AgentCommand[]): void
  state(owner: Owner, state: State, pairKey?: string): void
  of(owner: Owner): { state: State; commands: AgentCommand[] }
  lastOf(pairKey: string): AgentCommand[] | null | undefined
}
type StoreClass = new (emit?: (event: unknown) => void) => CommandsStore

const METHODS = ['set', 'state', 'of', 'lastOf'] as const

async function makeStore(check: string): Promise<CommandsStore> {
  if (!existsSync(join(ROOT, STORE))) throw new Error(`${check}: ${STORE} is missing.`)
  const module = (await import(join(ROOT, STORE))) as Record<string, unknown>
  const found = Object.values(module).find(
    (value): value is StoreClass =>
      typeof value === 'function' &&
      typeof (value as { prototype?: unknown }).prototype === 'object' &&
      METHODS.every((method) => typeof ((value as { prototype: Record<string, unknown> }).prototype[method]) === 'function')
  )
  if (!found) throw new Error(`${check}: ${STORE} exports no class with the methods ${METHODS.join(', ')}.`)
  return new found(() => undefined)
}

const LIST: AgentCommand[] = [
  { name: 'review', description: 'Review a pull request.', hint: '[pr]' },
  { name: 'compact', description: 'Keep a summary of the conversation.', hint: '' }
]
const PAIR = 'account-1|C:\\work\\fake-repo'
const OTHER_PAIR = 'account-2|C:\\work\\other-repo'

describe('S1-6: the last list of the pair of account and folder fills a session without a list', () => {
  it('S1-6: A is released and returns the list of P as no-agent; B starts with P and returns the list of P as loading', async () => {
    const check = 'S1-6'
    const store = await makeStore(check)
    const a: Owner = { sessionId: 'session-a' }
    const b: Owner = { sessionId: 'session-b' }

    // A starts with the pair P, then its process sends the list.
    store.state(a, 'loading', PAIR)
    expect(store.of(a), `${check}: a starting process with no list must be loading, with no last list of P yet.`).toEqual({ state: 'loading', commands: [] })
    store.set(a, PAIR, LIST)
    expect(store.of(a), `${check}: after the list of its process, A must be ready with that list.`).toEqual({ state: 'ready', commands: LIST })
    expect(store.lastOf(PAIR), `${check}: the list of A must become the last list of P.`).toEqual(LIST)

    // The process of A is released.
    store.state(a, 'no-agent')
    expect(store.of(a), `${check}: after the release, A must be no-agent and return the list of P.`).toEqual({ state: 'no-agent', commands: LIST })

    // B starts with the pair P.
    store.state(b, 'loading', PAIR)
    expect(store.of(b), `${check}: B starts with P and has no list: it must be loading and return the list of P.`).toEqual({ state: 'loading', commands: LIST })
  })

  it('S1-6: a session that starts with another pair has no last list, and returns an empty list', async () => {
    const check = 'S1-6'
    const store = await makeStore(check)
    store.set({ sessionId: 'session-a' }, PAIR, LIST)
    const c: Owner = { sessionId: 'session-c' }
    store.state(c, 'loading', OTHER_PAIR)
    expect(store.of(c), `${check}: a session with another pair must not get the list of P.`).toEqual({ state: 'loading', commands: [] })
    expect(store.lastOf(OTHER_PAIR) ?? [], `${check}: the other pair has no last list.`).toEqual([])
  })
})
