// Story S11 of milestone m1-chat (sidebar folders and session status): the unit test of the rule of
// the unread mark (S11-7, "plus a unit test of the rule") and the check S11-22. Spec:
// `docs/milestones/m1-chat/stories/s11-sidebar-status.md`, "The unread mark", "Interfaces" and "Checks".
//
// Coordinator decision (S5, S9 and S10 precedent): the locked unit checks of a story run as vitest
// tests in this folder, because `tsconfig.main.json` typechecks it.
//
// The level. The rule lives in the main process: the viewed session, the focus flag and the end of
// a turn in `send-message`. The test runs the main process as the app does: `composeMain`, the
// registry and `createInvoke` (pattern: `src/app/main/composition.test.ts`), with the simulated
// agent over real ACP and real SQLite. So it reads no name inside a slice.
//
// The interface that this test reads. Each name comes from the spec, "Interfaces":
// - `Composition.windowFocus(focused: boolean)`: the method that `src/main/index.ts` calls from the
//   window events `focus` and `blur`. The spec says "a method such as windowFocus"; this test fixes
//   the name `windowFocus`. No window exists here, so each test sets the focus first.
// - The contract `sessions.set-viewing { sessionId: string | null }`.
// - The contract `sessions.list { profileId }`: each item of `sessions` has the saved fields,
//   `unread` (boolean), and the live `status`, `openCardIds: string[]` and `revision`.
// - The session event `{ type: 'unread'; unread: boolean }` of `changeSchema`.
// - A turn end is the end of a turn in `send-message`: the status goes back to `idle`.
//
// The cases of the rule: a turn end marks the session when it is not the viewed session or the
// window has no focus. A normal end, a failed turn and a failed start count. A stop by the user and
// a turn that the quit ends do not. The mark clears when the session becomes the viewed session with
// the focus, or when the window gets the focus while the session is viewed.
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GithubPort, GithubTokenPort } from '../../src/building-blocks/github.port'
import { err, ok } from '../../src/building-blocks/result'
import { contracts } from '../../src/app/contracts'
import { composeMain, type Composition } from '../../src/app/main/composition'
import { createInvoke } from '../../src/app/main/ipc'
import { AcpAgents } from '../../src/providers/acp/acp-agents'
import { claudeCodeRecipe } from '../../src/providers/claude-code/claude-code'
import { ControlServer } from '../simulated-agent/control'

/** A test with real agent processes needs more than the 5 s of vitest. */
const TIME_LIMIT = 60_000
/** The longest wait for one fact of a turn. */
const WAIT = { timeout: 20_000, interval: 25 }

const github: GithubPort & GithubTokenPort = {
  listAccounts: async () => err('github-cli-missing', 'No gh.'),
  tokenOf: async (login) => ok(`fake-token-of-${login}`)
}

type Answer = { ok: true; value: Record<string, unknown> } | { ok: false; error: { code: string; message: string } }

interface Published {
  sessionId: string
  revision: number
  change: { type: string; status?: string; unread?: unknown; card?: { kind: string; permission?: { id: string }; elicitation?: { id: string } } }
}

interface ListItem {
  id: string
  title: string
  unread?: unknown
  status?: unknown
  openCardIds?: unknown
  revision?: unknown
}

interface Unit {
  control: ControlServer
  composition: Composition
  call(name: string, input: unknown): Promise<Answer>
  published: Published[]
  profileId: string
  folder: string
  /** True after a test called `shutdown` itself. */
  shutDown: boolean
}

let base: string
let unit: Unit | null = null

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'aether-s11-unread-'))
})

afterEach(async () => {
  if (unit) {
    if (!unit.shutDown) await unit.composition.shutdown()
    unit.composition.close()
    await unit.control.close()
    unit = null
  }
  await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

/** Starts the main process with the simulated agent and the profile "Personal". */
async function startUnit(): Promise<Unit> {
  const dataDir = join(base, 'data')
  const rootDir = join(base, 'directories')
  const folder = join(rootDir, 'repo-a')
  await mkdir(dataDir, { recursive: true })
  await mkdir(folder, { recursive: true })
  const control = await ControlServer.start()
  const agents = new AcpAgents({
    recipe: claudeCodeRecipe({ override: async () => ok(control.agent) }),
    environment: () => ({ ...process.env, ANTHROPIC_API_KEY: 'x' })
  })
  const published: Published[] = []
  const composed = composeMain({
    dataDir,
    github,
    agents,
    publish: (name, payload) => {
      if (name === 'sessions.changed') published.push(payload as Published)
    }
  })
  if (!composed.ok) throw new Error(`${composed.error.code}: ${composed.error.message}`)
  const invoke = createInvoke({ contracts, controllers: composed.value.controllers, isTrusted: () => true, log: () => undefined })
  const call = (name: string, input: unknown) => invoke({ sender: { id: 1, send: () => undefined, isDestroyed: () => false } }, name, input) as Promise<Answer>
  const added = await call('profiles.add', { name: 'Personal', workspaceDirectory: rootDir, github: null, claudeFolder: null })
  if (!added.ok) throw new Error(`profiles.add failed: ${added.error.message}`)
  const listed = await call('profiles.list', {})
  if (!listed.ok) throw new Error(`profiles.list failed: ${listed.error.message}`)
  const [profile] = listed.value.profiles as { id: string }[]
  if (!profile) throw new Error('profiles.list has no profile.')
  unit = { control, composition: composed.value, call, published, profileId: profile.id, folder, shutDown: false }
  return unit
}

async function createSession(u: Unit, prompt: string): Promise<string> {
  const created = await u.call('sessions.create', { profileId: u.profileId, prompt, mode: 'ask', model: 'default', sourcePath: u.folder, attachments: [] })
  if (!created.ok) throw new Error(`sessions.create failed: ${created.error.message}`)
  return (created.value as { id: string }).id
}

/** Calls `Composition.windowFocus`. It fails with the check when the method is missing. */
function windowFocus(u: Unit, focused: boolean, check: string): void {
  const method = (u.composition as unknown as { windowFocus?: unknown }).windowFocus
  if (typeof method !== 'function') throw new Error(`${check}: Composition has no method windowFocus(focused), which src/main/index.ts calls from the window events.`)
  ;(method as (focused: boolean) => void).call(u.composition, focused)
}

async function setViewing(u: Unit, sessionId: string | null, check: string): Promise<void> {
  const answer = await u.call('sessions.set-viewing', { sessionId })
  expect(answer, `${check}: sessions.set-viewing { sessionId: ${JSON.stringify(sessionId)} } must be accepted.`).toEqual({ ok: true, value: expect.anything() })
}

async function itemOf(u: Unit, sessionId: string, check: string): Promise<ListItem> {
  const listed = await u.call('sessions.list', { profileId: u.profileId })
  if (!listed.ok) throw new Error(`${check}: sessions.list failed: ${listed.error.message}`)
  const item = (listed.value.sessions as ListItem[]).find((candidate) => candidate.id === sessionId)
  if (!item) throw new Error(`${check}: sessions.list does not list the session.`)
  return item
}

/** The saved unread mark of the session, as `sessions.list` gives it. */
async function unreadOf(u: Unit, sessionId: string, check: string): Promise<unknown> {
  const item = await itemOf(u, sessionId, check)
  if (!('unread' in item)) throw new Error(`${check}: the items of sessions.list have no field "unread".`)
  return item.unread
}

const unreadEvents = (u: Unit, sessionId: string) =>
  u.published.filter((event) => event.sessionId === sessionId && event.change.type === 'unread').map((event) => event.change.unread)

const idleCount = (u: Unit, sessionId: string) =>
  u.published.filter((event) => event.sessionId === sessionId && event.change.type === 'status' && event.change.status === 'idle').length

/** Sends a message and waits until the turn ended: the status of the session went back to idle. */
async function runTurn(u: Unit, sessionId: string, check: string): Promise<void> {
  const before = idleCount(u, sessionId)
  const sent = await u.call('sessions.send-message', { id: sessionId, text: 'Say hello' })
  expect(sent, `${check}: sessions.send-message refused the message.`).toEqual({ ok: true, value: {} })
  await vi.waitFor(() => {
    if (idleCount(u, sessionId) <= before) throw new Error(`${check}: the turn did not end.`)
  }, WAIT)
}

const reply = (gate?: string) => ({ prompt: [...(gate ? [{ do: 'gate', name: gate }] : []), { do: 'say', text: 'Done.' }] })

describe('S11-7 (unit): the rule of the unread mark at a turn end', () => {
  it(
    'S11-7: the viewed session ends its turn while the window has no focus: it gets the mark; the focus then clears it',
    async () => {
      const check = 'S11-7'
      const u = await startUnit()
      const a = await createSession(u, 'Fix the login page')
      await setViewing(u, a, check)
      windowFocus(u, false, check)
      await u.control.scenario('steps', reply())
      await runTurn(u, a, check)
      expect(await unreadOf(u, a, check), `${check}: a turn end without the focus must set the mark.`).toBe(true)
      expect(unreadEvents(u, a), `${check}: the mark must go out as the session event { type: 'unread', unread: true }.`).toEqual([true])

      windowFocus(u, true, check)
      expect(await unreadOf(u, a, check), `${check}: the focus on the window must clear the mark of the viewed session.`).toBe(false)
      expect(unreadEvents(u, a), `${check}: the clear must go out as the session event { type: 'unread', unread: false }.`).toEqual([true, false])
    },
    TIME_LIMIT
  )

  it(
    'S11-7 rule (S11-6): a session that is not viewed gets the mark at its turn end; viewing it with the focus clears it',
    async () => {
      const check = 'S11-7 rule (S11-6)'
      const u = await startUnit()
      const a = await createSession(u, 'Fix the login page')
      const b = await createSession(u, 'Sort the notes')
      windowFocus(u, true, check)
      await setViewing(u, b, check)
      await u.control.scenario('steps', reply())
      await runTurn(u, a, check)
      expect(await unreadOf(u, a, check), `${check}: a turn end of a session that is not viewed must set the mark.`).toBe(true)
      expect(await unreadOf(u, b, check), `${check}: the viewed session B must get no mark.`).toBe(false)

      await setViewing(u, a, check)
      expect(await unreadOf(u, a, check), `${check}: viewing A with the focus must clear its mark.`).toBe(false)
    },
    TIME_LIMIT
  )

  it(
    'S11-7 rule (S11-8): the viewed session ends its turn while the window has the focus: no mark',
    async () => {
      const check = 'S11-7 rule (S11-8)'
      const u = await startUnit()
      const a = await createSession(u, 'Fix the login page')
      windowFocus(u, true, check)
      await setViewing(u, a, check)
      await u.control.scenario('steps', reply())
      await runTurn(u, a, check)
      expect(await unreadOf(u, a, check), `${check}: a turn end of the viewed session with the focus must set no mark.`).toBe(false)
      expect(unreadEvents(u, a).filter((value) => value === true), `${check}: no event must set the mark.`).toEqual([])
    },
    TIME_LIMIT
  )

  it(
    'S11-7 rule (S11-12): a failed start (not signed in) and a failed turn set the mark; a stop by the user does not',
    async () => {
      const check = 'S11-7 rule (S11-12)'
      const u = await startUnit()
      const failedStart = await createSession(u, 'Fix the login page')
      const failedTurn = await createSession(u, 'Rename the old files')
      const stopped = await createSession(u, 'Sort the notes')
      windowFocus(u, true, check)
      await setViewing(u, null, check)

      await u.control.scenario('steps', { initialize: [{ do: 'fail', code: -32000, message: 'Authentication required' }], prompt: [] })
      await runTurn(u, failedStart, check)
      expect(await unreadOf(u, failedStart, check), `${check}: a start that fails as "not signed in" must set the mark.`).toBe(true)

      await u.control.scenario('steps', { prompt: [{ do: 'fail', code: -32603, message: 'The model is overloaded.' }] })
      await runTurn(u, failedTurn, check)
      expect(await unreadOf(u, failedTurn, check), `${check}: a failed turn must set the mark.`).toBe(true)

      await u.control.scenario('steps', reply('hold-stop'))
      const before = idleCount(u, stopped)
      expect(await u.call('sessions.send-message', { id: stopped, text: 'Say hello' }), `${check}: sessions.send-message refused the message.`).toEqual({ ok: true, value: {} })
      await u.control.waitForGate('hold-stop')
      expect(await u.call('sessions.stop', { id: stopped }), `${check}: sessions.stop refused the stop.`).toMatchObject({ ok: true })
      await vi.waitFor(() => {
        if (idleCount(u, stopped) <= before) throw new Error(`${check}: the stopped turn did not end.`)
      }, WAIT)
      expect(await unreadOf(u, stopped, check), `${check}: a stop by the user must set no mark.`).toBe(false)
    },
    TIME_LIMIT
  )

  it(
    'S11-7 rule (open choice 4, A): a turn that the quit of Aether ends sets no mark',
    async () => {
      const check = 'S11-7 rule (quit)'
      const u = await startUnit()
      const a = await createSession(u, 'Fix the login page')
      windowFocus(u, true, check)
      await setViewing(u, null, check)
      // A control turn first: the rule marks a session that is not viewed, so the quit below has a meaning.
      await u.control.scenario('steps', reply())
      await runTurn(u, a, check)
      expect(await unreadOf(u, a, check), `${check}: a turn end of a session that is not viewed must set the mark.`).toBe(true)
      await setViewing(u, a, check)
      await setViewing(u, null, check)
      expect(await unreadOf(u, a, check), `${check}: viewing A with the focus must clear its mark.`).toBe(false)

      await u.control.scenario('steps', reply('hold-quit'))
      const before = idleCount(u, a)
      expect(await u.call('sessions.send-message', { id: a, text: 'Say hello' }), `${check}: sessions.send-message refused the message.`).toEqual({ ok: true, value: {} })
      await u.control.waitForGate('hold-quit')
      u.shutDown = true
      await u.composition.shutdown()
      await vi.waitFor(() => {
        if (idleCount(u, a) <= before) throw new Error(`${check}: the turn did not end at the quit.`)
      }, WAIT)
      expect(await unreadOf(u, a, check), `${check}: a turn that the quit of Aether ends must set no mark.`).toBe(false)
    },
    TIME_LIMIT
  )
})

describe('S11-22: sessions.list gives the live state of a session while its turn runs', () => {
  it(
    'S11-22: while a turn waits for a permission, a reload (sessions.list) gives status working, the open card IDs and the revision of the session events',
    async () => {
      const check = 'S11-22'
      const u = await startUnit()
      const a = await createSession(u, 'Fix the login page')
      await u.control.scenario('steps', {
        prompt: [{ do: 'ask', requests: [{ id: 'run-tests', title: 'npm test', kind: 'execute' }] }, { do: 'answers' }, { do: 'say', text: 'Done.' }]
      })
      expect(await u.call('sessions.send-message', { id: a, text: 'Run the tests' }), `${check}: sessions.send-message refused the message.`).toEqual({ ok: true, value: {} })
      await vi.waitFor(() => {
        if (!u.published.some((event) => event.sessionId === a && event.change.type === 'card-opened')) throw new Error(`${check}: no card opened.`)
      }, WAIT)
      const opened = u.published.find((event) => event.sessionId === a && event.change.type === 'card-opened')!
      const cardId = opened.change.card?.permission?.id ?? opened.change.card?.elicitation?.id
      const revision = u.published.filter((event) => event.sessionId === a).at(-1)!.revision

      const item = await itemOf(u, a, check)
      expect(item.status, `${check}: the item of sessions.list must have the live status "working".`).toBe('working')
      expect(item.openCardIds, `${check}: the item of sessions.list must have the IDs of the open cards.`).toEqual([cardId])
      expect(item.revision, `${check}: the item of sessions.list must have the revision of the last session event.`).toBe(revision)
      expect(item.unread, `${check}: the item of sessions.list must have the field "unread".`).toBe(false)
    },
    TIME_LIMIT
  )
})
