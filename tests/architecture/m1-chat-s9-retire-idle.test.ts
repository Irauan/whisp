// Story S9 of milestone m1-chat (idle release and process limit): the slice tests of the release.
// Spec: `docs/milestones/m1-chat/stories/s9-idle-release.md`.
//
// A21: a person's session is idle for 30 minutes, measured with a test clock. Its process closes.
//      The next message resumes the session.
// S9-3: a message during the close waits, then resumes in one new process.
//
// Level (open choice 4, A, decided by the user): a slice test. The release handler, a fake clock,
// an explicit call of the handler, real SQLite, and the simulated agent over real ACP. The product
// has no test hook. Coordinator decision: these tests run as locked vitest tests outside
// `tests/acceptance/`, as `contracts.test.ts` does. They live here, because `tsconfig.main.json`
// typechecks this folder.
//
// The wiring. The test connects the slices as the composition root does, with the code of today:
// - `SessionStore`, `Transcript` and `Processes` of `src/features/sessions`, on an SQLite database
//   with the migrations of the product.
// - The session comes from `createSessionHandler`, so it is a person's session (`sessions.create`
//   writes `person`).
// - `sendMessageHandler` with the members of `SendMessageDeps` of S4. S9 keeps them sufficient: a
//   member that S9 adds to `SendMessageDeps` must be optional.
// - The agent port is `AcpAgents` with the launch recipe of Claude Code, whose program is the
//   simulated agent, as an `agents.json` entry gives it. Updates go to `recordAgentUpdateHandler`.
// - The gate before a start (`guard`) allows each folder. The test records each call.
//
// The interface that this test reads (S9 test contract). The spec gives the names "for example";
// this test fixes them:
// - `src/features/sessions/retire-idle/retire-idle.handler.ts` exports
//     retireIdleHandler(deps: { store, transcript, processes, clock, limits, log }): Promise<void>
//   with `store: SessionStore`, `transcript: Transcript`, `processes: Processes`, `clock: Clock`,
//   `limits: ReleaseLimits` and `log(message, cause?)`. It reads the open sessions and their busy
//   state, calls the pure function, and closes the processes it returns. Its promise resolves when
//   the closes that it started have ended. A member that a later story adds to these deps (for
//   example the open requests of S5) must be optional.
// - `src/features/sessions/idle-release.ts` exports `RELEASE_LIMITS`, the constants of open
//   choice 2 (A). The test passes them as `limits`, so 30 minutes is the time of the product.
// - `send-message` marks the idle time at the end of a turn with `clock` of its deps.
// - The column `sessions.started_by` holds `person` for a session of `sessions.create` (migration 004).
//
// No test sleeps. A test waits on a report of the simulated agent, or polls the state of a process
// with a time limit and a message.
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AccountsInStart } from '../../src/building-blocks/accounts-in-start'
import type { Clock } from '../../src/building-blocks/clock.port'
import { openDatabase, type Database } from '../../src/building-blocks/database'
import type { GithubTokenPort } from '../../src/building-blocks/github.port'
import { MIGRATIONS } from '../../src/building-blocks/migrations'
import { ok } from '../../src/building-blocks/result'
import { createSessionHandler } from '../../src/features/sessions/create/create.handler'
import type { Entry } from '../../src/features/sessions/entry'
import { Processes } from '../../src/features/sessions/processes.store'
import { recordAgentUpdateHandler } from '../../src/features/sessions/record-agent-update/record-agent-update.handler'
import { sendMessageHandler, type SendMessageDeps, type StartRequest } from '../../src/features/sessions/send-message/send-message.handler'
import { SessionStore } from '../../src/features/sessions/session.store'
import { Transcript } from '../../src/features/sessions/transcript.store'
import { AcpAgents } from '../../src/providers/acp/acp-agents'
import { claudeCodeRecipe } from '../../src/providers/claude-code/claude-code'
import { ControlServer, type AcpMessage } from '../simulated-agent/control'

const ROOT = resolve(__dirname, '../..')
const HANDLER = 'src/features/sessions/retire-idle/retire-idle.handler.ts'
const LIMITS_MODULE = 'src/features/sessions/idle-release.ts'

const MINUTE = 60_000
/** A test with real agent processes needs more than the 5 s of vitest. */
const TIME_LIMIT = 60_000
/** The longest wait for a process to end after the release. */
const END_LIMIT = 15_000

interface ReleaseLimits {
  releaseMs: { person: number; automation: number }
  idleLimit: number
}

/** The deps of the release handler, as the header gives them. */
interface RetireIdleDeps {
  store: SessionStore
  transcript: Transcript
  processes: Processes
  clock: Clock
  limits: ReleaseLimits
  log(message: string, cause?: unknown): void
}

type RetireIdle = (deps: RetireIdleDeps) => Promise<void>

/** Loads a module of the story at run time. It throws a message that names the check when the module is missing. */
async function loadModule<T>(file: string, check: string, what: string): Promise<T> {
  if (!existsSync(join(ROOT, file))) throw new Error(`${check}: ${what} does not exist: ${file} is missing.`)
  return (await import(join(ROOT, file))) as T
}

async function loadRelease(check: string): Promise<{ retireIdleHandler: RetireIdle; limits: ReleaseLimits }> {
  const handler = await loadModule<{ retireIdleHandler?: unknown }>(HANDLER, check, 'the release handler')
  if (typeof handler.retireIdleHandler !== 'function') throw new Error(`${check}: ${HANDLER} exports no function retireIdleHandler.`)
  const constants = await loadModule<{ RELEASE_LIMITS?: ReleaseLimits }>(LIMITS_MODULE, check, 'the module of the release times')
  if (constants.RELEASE_LIMITS === undefined) throw new Error(`${check}: ${LIMITS_MODULE} exports no RELEASE_LIMITS.`)
  return { retireIdleHandler: handler.retireIdleHandler as RetireIdle, limits: constants.RELEASE_LIMITS }
}

/** Whether a process runs. Signal 0 only checks it. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** A report of the simulated agent, with a time limit, so a missing report fails with the message. */
async function reach<T>(promise: Promise<T>, message: string, timeout = END_LIMIT): Promise<T> {
  let done = false
  let value: T | undefined
  void promise.then((result) => {
    value = result
    done = true
  })
  await expect.poll(() => done, { message, timeout }).toBe(true)
  return value as T
}

const sessionIdOf = (message: AcpMessage) => (message.params as { sessionId?: unknown } | undefined)?.sessionId

/** A clock that the test moves. */
class TestClock implements Clock {
  private time = new Date('2026-03-01T09:00:00.000Z').getTime()
  now(): Date {
    return new Date(this.time)
  }
  advance(ms: number): void {
    this.time += ms
  }
}

interface Slice {
  database: Database
  store: SessionStore
  transcript: Transcript
  processes: Processes
  clock: TestClock
  control: ControlServer
  /** The start requests that reached the gate, with the processes of the agent that ran at that moment. */
  guardCalls: { request: StartRequest; running: number[] }[]
  logged: string[]
  sessionId: string
  send(text: string): ReturnType<typeof sendMessageHandler>
  /** The saved entries of the session. */
  entries(): Entry[]
  /** Loads the release handler. The function it returns calls it with the deps of the header and the constants of the product. */
  release(check: string): Promise<() => Promise<void>>
  /** Loads the release handler and calls it once. */
  retire(check: string): Promise<void>
}

let folder: string
let slice: Slice

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'aether-s9-slice-'))
  const control = await ControlServer.start()
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  const { database } = opened.value
  // A profile with no GitHub account, so no token query runs. All data is fake.
  database.prepare('INSERT INTO profiles (id, name, github_login, created_at) VALUES (?, ?, ?, ?)').run('p1', 'Personal', null, '2026-01-01')
  const store = new SessionStore(database)
  const clock = new TestClock()
  let count = 0
  const ids = { next: () => `id${++count}` }
  const transcript = new Transcript(store, () => undefined, clock, ids)
  const processes = new Processes()
  const logged: string[] = []
  const log = (message: string, cause?: unknown) => logged.push(`${message} ${String(cause)}`)
  const guardCalls: Slice['guardCalls'] = []
  const agents = new AcpAgents({
    recipe: claudeCodeRecipe({ override: async () => ok(control.agent) }),
    environment: () => ({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }),
    // Longer than any gate that a test holds while a process closes.
    closeLimitMs: 20_000
  })
  const github: GithubTokenPort = { tokenOf: () => Promise.resolve(ok('fake-token-of-nobody')) }
  const deps: SendMessageDeps = {
    store,
    transcript,
    processes,
    agents,
    github,
    starting: new AccountsInStart(),
    record: (sessionId, update) => recordAgentUpdateHandler({ transcript, store }, { sessionId, update }),
    guard: (request) => {
      guardCalls.push({ request, running: control.pids.filter(isRunning) })
      return Promise.resolve(ok({}))
    },
    clock,
    ids,
    log
  }
  const created = createSessionHandler(
    { store, clock, ids },
    { profileId: 'p1', prompt: 'Say hello', mode: 'ask', model: 'default', sourcePath: folder, attachments: [] }
  )
  if (!created.ok) throw new Error(`The session was not created: ${created.error.message}`)
  const sessionId = created.value.id

  slice = {
    database,
    store,
    transcript,
    processes,
    clock,
    control,
    guardCalls,
    logged,
    sessionId,
    send: (text) => sendMessageHandler(deps, { id: sessionId, text }),
    entries: () => store.entriesOf(sessionId).map((view) => view.entry),
    release: async (check) => {
      const { retireIdleHandler, limits } = await loadRelease(check)
      return async () => {
        await retireIdleHandler({ store, transcript, processes, clock, limits, log })
      }
    },
    retire: async (check) => {
      const run = await slice.release(check)
      await run()
    }
  }
})

afterEach(async () => {
  // A process of the scenario "slow-exit" waits at this gate when it closes.
  await slice.control.open('exit')
  await slice.processes.releaseAll()
  // A process that the product left alive must not outlive the test.
  for (const pid of slice.control.pids) if (isRunning(pid)) process.kill(pid)
  await slice.control.close()
  slice.database.close()
  await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}, TIME_LIMIT)

/** Sends a message and waits until its turn ends. The reply of the agent is then saved. */
async function turn(text: string, check: string): Promise<void> {
  const sent = slice.send(text)
  expect(sent.result, `${check}: Aether did not accept the message "${text}".`).toEqual({ ok: true, value: {} })
  await sent.finished
}

/** The agent texts of the saved entries. */
const agentTexts = (entries: Entry[]) => entries.flatMap((entry) => (entry.kind === 'agent' ? [entry.text] : []))

/** The ACP messages of one method that one agent process received. */
const messagesOf = (method: string, pid: number) =>
  slice.control
    .receivedBy(method)
    .filter((entry) => entry.pid === pid)
    .map(({ message }) => message)

/** Checks that the process `second` resumed the agent session of the process `first`, and got the prompt `text` in it. */
function expectResumed(check: string, first: number, second: number, text: string): void {
  const earlier = sessionIdOf(messagesOf('session/prompt', first)[0]!)
  expect(earlier, `${check}: the first process got no prompt with a session ID.`).toEqual(expect.any(String))
  const resumes = [...messagesOf('session/resume', second), ...messagesOf('session/load', second)].map(sessionIdOf)
  expect(resumes, `${check}: the new process must get session/resume or session/load of the agent session ${String(earlier)}.`).toEqual([earlier])
  expect(messagesOf('session/new', second), `${check}: the new process must not create a new agent session.`).toHaveLength(0)
  const prompts = messagesOf('session/prompt', second)
  expect(prompts, `${check}: the new process must get exactly one prompt.`).toHaveLength(1)
  expect(sessionIdOf(prompts[0]!), `${check}: the next message must go to the resumed agent session.`).toBe(earlier)
  expect(prompts[0]!.params, `${check}: the new process must get the message "${text}".`).toMatchObject({ prompt: [{ type: 'text', text }] })
}

/** Checks that the started_by of the session row is `person` (migration 004, `sessions.create` writes it). */
function expectPersonSession(check: string): void {
  let row: { started_by?: unknown } | undefined
  try {
    row = slice.database.prepare('SELECT started_by FROM sessions WHERE id = ?').get(slice.sessionId) as { started_by?: unknown } | undefined
  } catch (error) {
    throw new Error(`${check}: the session row has no column started_by (migration 004): ${String(error)}`)
  }
  expect(row?.started_by, `${check}: sessions.create must save the session as started by a person.`).toBe('person')
}

describe('A21: a person\'s session that is idle for 30 minutes closes its process, and the next message resumes it', () => {
  it(
    'A21: the process stays 1 ms before 30 minutes of idle time, closes at 30 minutes, and the next message resumes the agent session in a new process',
    async () => {
      const { control, clock, transcript, sessionId } = slice
      await control.scenario('text', { chunks: ['Hello ', 'from the agent.'] })
      await turn('Say hello', 'A21')
      expect(control.pids, 'A21: the first message must start one agent process.').toHaveLength(1)
      const first = control.pids[0]!
      expect(agentTexts(slice.entries()), 'A21: the first reply was not saved.').toEqual(['Hello from the agent.'])

      // 1 ms before the release time, the release keeps the process: the next turn runs in it.
      clock.advance(30 * MINUTE - 1)
      await slice.retire('A21')
      await control.scenario('text', { chunks: ['Still ', 'here.'] })
      await turn('Still there?', 'A21')
      expect(control.pids, 'A21: 1 ms before 30 minutes of idle time, the release must keep the process, so the next turn must run in it.').toEqual([
        first
      ])
      expect(isRunning(first), 'A21: the process must still run 1 ms before 30 minutes of idle time.').toBe(true)
      expect(messagesOf('session/prompt', first), 'A21: both turns must run in the first process.').toHaveLength(2)

      // The idle time starts again at the end of that turn. 30 minutes later the process closes.
      clock.advance(30 * MINUTE)
      const before = slice.entries()
      await slice.retire('A21')
      await expect
        .poll(() => isRunning(first), { message: 'A21: after 30 minutes of idle time, the process of the person\'s session did not end.', timeout: END_LIMIT })
        .toBe(false)
      expect(transcript.statusOf(sessionId), 'A21 (States): after the release, the session must show Idle.').toBe('idle')
      expect(slice.entries(), 'A21 (Screens): the release is silent, so the transcript must get no entry.').toEqual(before)

      // The next message starts a new process that resumes the agent session, as after a restart (S4).
      await control.scenario('text', { chunks: ['Welcome ', 'back.'] })
      const next = slice.send('Are you back?')
      expect(next.result, 'A21: Aether did not accept the next message after the release.').toEqual({ ok: true, value: {} })
      expect(transcript.statusOf(sessionId), 'A21 (States): the next message after a release must show "Starting Claude Code" (status starting).').toBe(
        'starting'
      )
      await next.finished
      expect(control.pids, 'A21: the next message after the release must start exactly one new process.').toHaveLength(2)
      const second = control.pids[1]!
      expectResumed('A21', first, second, 'Are you back?')
      const entries = slice.entries()
      expect(agentTexts(entries), 'A21: the reply of the resumed session was not saved after the earlier replies.').toEqual([
        'Hello from the agent.',
        'Still here.',
        'Welcome back.'
      ])
      expect(
        entries.filter((entry) => entry.kind === 'notice' && entry.code === 'resume-failed'),
        'A21: the resume must work, so no notice "Aether could not continue the earlier conversation" may show.'
      ).toEqual([])
      // The 30 minutes apply because a person started the session.
      expectPersonSession('A21')
    },
    TIME_LIMIT
  )
})

describe('S9-3: a message during the close waits, then resumes in one new process', () => {
  it(
    'S9-3: a message that comes while the released process closes starts no process before the close ends, then resumes the agent session in one new process',
    async () => {
      const { control, clock } = slice
      // The agent waits at the gate "exit" after its stdin closes, so the close takes until the test opens it.
      await control.scenario('slow-exit', { gate: 'exit', chunks: ['Hello ', 'from the agent.'] })
      await turn('Say hello', 'S9-3')
      expect(control.pids, 'S9-3: the first message must start one agent process.').toHaveLength(1)
      const first = control.pids[0]!
      expect(slice.guardCalls, 'S9-3: the first start must pass the gate once.').toHaveLength(1)

      clock.advance(30 * MINUTE)
      const run = await slice.release('S9-3')
      const retiring = run()
      // A failure of the handler shows at the `await` below, not as an unhandled rejection.
      void retiring.catch(() => undefined)
      await reach(control.waitForGate('exit'), 'S9-3: after 30 minutes of idle time, the release did not close the process (its stdin did not close).')

      // The close runs now: the old process waits at the gate. A message comes.
      const next = slice.send('Next message')
      expect(next.result, 'S9-3: Aether must accept a message that comes during the close.').toEqual({ ok: true, value: {} })
      await control.open('exit')
      await retiring
      await reach(next.finished, 'S9-3: the turn of the message that came during the close did not end.')

      // Rule 8: the start waits for the close, then passes the gate, then starts the new process.
      expect(slice.guardCalls, 'S9-3: the new start must pass the gate exactly once.').toHaveLength(2)
      expect(
        slice.guardCalls[1]!.running,
        'S9-3 (rules 7 and 8): the new start began while the old process still ran. It must wait for the close to end.'
      ).not.toContain(first)
      expect(control.pids, 'S9-3: the message must start exactly one new process.').toHaveLength(2)
      const second = control.pids[1]!
      expect(isRunning(first), 'S9-3: two processes must never run for one session, so the old process must have ended.').toBe(false)
      expectResumed('S9-3', first, second, 'Next message')
      expect(agentTexts(slice.entries()), 'S9-3: the reply to the message that came during the close was not saved.').toEqual([
        'Hello from the agent.',
        'Hello from the agent.'
      ])
    },
    TIME_LIMIT
  )
})
