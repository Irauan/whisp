// Story S10 of milestone m1-chat (session title from Claude): the checks S10-7 and S10-9, which need
// an agent process. Spec: `docs/milestones/m1-chat/stories/s10-session-title.md`, "Checks".
//
// S10-7 (unit, provider): `session_info_update` with a string `title` becomes the port update
//        `{ type: 'title', title }`. One with `title: null`, or with no `title` field, gives none.
// S10-9 (unit, the idle time of S9): a title that comes outside a turn restarts the idle time, as
//        every other update outside a turn does (open choice 2, B).
//
// Level. The provider is `AcpAgents` with the launch recipe of Claude Code, whose program is the
// simulated agent over real ACP, as in `src/providers/acp/acp-agents.test.ts`. S10-9 connects the
// slices as `m1-chat-s9-retire-idle.test.ts` does: `SessionStore`, `Transcript` and `Processes` on
// SQLite with the migrations of the product, `sendMessageHandler` with the members of
// `SendMessageDeps`, `recordAgentUpdateHandler` with `{ transcript, store }`, and a test clock. A
// direct call of the listener would not test S10: `send-message` already marks the idle time for
// each update that the provider gives. The title must come from the provider.
//
// The simulated agent is used as it is: the scenario `steps` sends the title with the step
// `{ do: 'update', update: { sessionUpdate: 'session_info_update', ... } }`, and
// `{ do: 'detach', steps }` behind a gate sends one outside a turn.
//
// Coordinator decision (S5 and S9 precedent): these locked tests run as vitest tests in this folder,
// because `tsconfig.main.json` typechecks it. No test sleeps. A test waits on a report of the
// simulated agent, or polls with a time limit and a message.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AccountsInStart } from '../../src/building-blocks/accounts-in-start'
import type { AgentListener, AgentProcess, AgentUpdate } from '../../src/building-blocks/agent.port'
import type { Clock } from '../../src/building-blocks/clock.port'
import { openDatabase, type Database } from '../../src/building-blocks/database'
import type { GithubTokenPort } from '../../src/building-blocks/github.port'
import { MIGRATIONS } from '../../src/building-blocks/migrations'
import { ok } from '../../src/building-blocks/result'
import { createSessionHandler } from '../../src/features/sessions/create/create.handler'
import { RELEASE_LIMITS } from '../../src/features/sessions/idle-release'
import { Processes } from '../../src/features/sessions/processes.store'
import { recordAgentUpdateHandler } from '../../src/features/sessions/record-agent-update/record-agent-update.handler'
import { retireIdleHandler } from '../../src/features/sessions/retire-idle/retire-idle.handler'
import { sendMessageHandler, type SendMessageDeps } from '../../src/features/sessions/send-message/send-message.handler'
import { SessionStore } from '../../src/features/sessions/session.store'
import { Transcript } from '../../src/features/sessions/transcript.store'
import { AcpAgents } from '../../src/providers/acp/acp-agents'
import { claudeCodeRecipe } from '../../src/providers/claude-code/claude-code'
import { ControlServer } from '../simulated-agent/control'

const MINUTE = 60_000
/** A test with real agent processes needs more than the 5 s of vitest. */
const TIME_LIMIT = 60_000
/** The longest wait for one report or one effect. */
const WAIT = 10_000

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
async function reach<T>(promise: Promise<T>, message: string): Promise<T> {
  let done = false
  let value: T | undefined
  void promise.then((result) => {
    value = result
    done = true
  })
  await expect.poll(() => done, { message, timeout: WAIT }).toBe(true)
  return value as T
}

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

const sessionInfo = (fields: Record<string, unknown>) => ({ do: 'update', update: { sessionUpdate: 'session_info_update', ...fields } })

let control: ControlServer
let folder: string
let opened: AgentProcess[]

beforeEach(async () => {
  control = await ControlServer.start()
  folder = await mkdtemp(join(tmpdir(), 'aether-s10-agent-'))
  opened = []
})

afterEach(async () => {
  await Promise.all(opened.map((agent) => agent.close()))
  // A process that the product left alive must not outlive the test.
  for (const pid of control.pids) if (isRunning(pid)) process.kill(pid)
  await control.close()
  await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}, TIME_LIMIT)

const agents = () =>
  new AcpAgents({
    recipe: claudeCodeRecipe({ override: async () => ok(control.agent) }),
    environment: () => ({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }),
    closeLimitMs: 2000
  })

describe('S10-7: the provider turns session_info_update with a title into the port update title', () => {
  it(
    'S10-7: a title with updatedAt gives one update { type: title, title }, and a null title or an update with only _meta gives none',
    async () => {
      const check = 'S10-7'
      await control.scenario('steps', {
        prompt: [
          sessionInfo({ title: 'Greeting test', updatedAt: '2026-11-28T10:00:00.000Z', _meta: { source: 'fake' } }),
          sessionInfo({ title: null, updatedAt: '2026-11-28T10:00:01.000Z' }),
          sessionInfo({ _meta: { promptSuggestion: 'Try the tests' } }),
          { do: 'say', text: 'Done.' }
        ]
      })
      const updates: AgentUpdate[] = []
      const listener: AgentListener = {
        update: (update) => updates.push(update),
        exited: () => undefined,
        permission: () => undefined,
        permissionClosed: () => undefined,
        elicitation: () => undefined,
        elicitationClosed: () => undefined
      }
      const agent = agents().start(
        { mainDirectory: folder, additionalDirectories: [], model: 'default', mode: 'ask', sharedItems: [], settings: {}, environment: {}, resume: null },
        listener
      )
      opened.push(agent)
      expect((await agent.ready).ok, `${check}: the simulated agent did not start.`).toBe(true)
      expect(await agent.prompt('Name this session'), `${check}: the turn did not end.`).toEqual({ ok: true, value: 'end_turn' })
      // The text after the three updates shows that the listener got all of them.
      await expect
        .poll(() => updates.some((update) => update.type === 'text'), { message: `${check}: the listener did not get the text after the updates.`, timeout: WAIT })
        .toBe(true)

      expect(
        updates.filter((update) => update.type !== 'text'),
        `${check}: the listener must get exactly one update { type: 'title', title: 'Greeting test' } (no updatedAt, no _meta), and none for the null title or the update with only _meta.`
      ).toEqual([{ type: 'title', title: 'Greeting test' }])
    },
    TIME_LIMIT
  )
})

describe('S10-9: a title outside a turn restarts the idle time', () => {
  let database: Database | undefined
  let processes: Processes | undefined

  afterEach(async () => {
    await processes?.releaseAll()
    database?.close()
  }, TIME_LIMIT)

  it(
    'S10-9: 20 minutes after the turn ended, a title from the agent restarts the idle time, so the release at 30 minutes after the turn keeps the process',
    async () => {
      const check = 'S10-9'
      const result = openDatabase(':memory:', MIGRATIONS)
      if (!result.ok) throw new Error(result.error.message)
      const db = result.value.database
      database = db
      // A profile with no GitHub account, so no token query runs. All data is fake.
      db.prepare('INSERT INTO profiles (id, name, github_login, created_at) VALUES (?, ?, ?, ?)').run('p1', 'Personal', null, '2026-01-01')
      const store = new SessionStore(db)
      const clock = new TestClock()
      let count = 0
      const ids = { next: () => `id${++count}` }
      const transcript = new Transcript(store, () => undefined, clock, ids)
      const running = new Processes()
      processes = running
      const log = () => undefined
      const github: GithubTokenPort = { tokenOf: () => Promise.resolve(ok('fake-token-of-nobody')) }
      const deps: SendMessageDeps = {
        store,
        transcript,
        processes: running,
        agents: agents(),
        github,
        starting: new AccountsInStart(),
        record: (sessionId, update) => recordAgentUpdateHandler({ transcript, store }, { sessionId, update }),
        guard: () => Promise.resolve(ok({})),
        clock,
        ids,
        log
      }
      const created = createSessionHandler(
        { store, clock, ids },
        { profileId: 'p1', prompt: 'Say hello', mode: 'ask', model: 'default', sourcePath: folder, attachments: [] }
      )
      if (!created.ok) throw new Error(`The session was not created: ${created.error.message}`)
      const id = created.value.id

      // The turn ends. The detached steps then wait at the gate "late", outside the turn.
      await control.scenario('steps', {
        prompt: [{ do: 'say', text: 'Hello.' }, { do: 'detach', steps: [{ do: 'gate', name: 'late' }, sessionInfo({ title: 'Late title' })] }]
      })
      const sent = sendMessageHandler(deps, { id, text: 'Say hello' })
      expect(sent.result, `${check}: Aether did not accept the first message.`).toEqual({ ok: true, value: {} })
      await sent.finished
      expect(control.pids, `${check}: the first message must start one agent process.`).toHaveLength(1)
      const pid = control.pids[0]!
      const turnEnd = clock.now().getTime()
      expect(running.idleSince(id)?.getTime(), `${check}: the idle time must start at the end of the turn (S9).`).toBe(turnEnd)

      // 20 minutes later, the agent sends a title outside the turn.
      await reach(control.waitForGate('late'), `${check}: the detached steps of the agent did not start.`)
      clock.advance(20 * MINUTE)
      await control.open('late')
      await expect
        .poll(() => running.idleSince(id)?.getTime(), {
          message: `${check}: the title that came outside a turn did not restart the idle time (idleSince must move to the time of the title).`,
          timeout: WAIT
        })
        .toBe(turnEnd + 20 * MINUTE)

      // 30 minutes after the turn, only 10 minutes passed since the title: the release keeps the process.
      clock.advance(10 * MINUTE)
      await retireIdleHandler({ store, transcript, processes: running, clock, limits: RELEASE_LIMITS, log, openRequests: (sessionId) => transcript.openCardCount(sessionId) })
      expect(isRunning(pid), `${check}: the release closed the process 10 minutes after the title. The title must restart the idle time.`).toBe(true)
      expect(running.get(id), `${check}: the release dropped the process of the session 10 minutes after the title.`).toBeDefined()
    },
    TIME_LIMIT
  )
})
