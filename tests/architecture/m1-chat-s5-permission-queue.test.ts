// Story S5 of milestone m1-chat (permission queue): the slice tests of the checks S5-2, S5-3, S5-4,
// S5-5, S5-8, S5-11, S5-12, S5-16, S5-25, S5-28, S5-29, S5-30 and S5-32.
// Spec: `docs/milestones/m1-chat/stories/s5-permission-queue.md`, "Checks" (level "Slice").
//
// Level (decision 0009): real SQLite and the simulated agent over real ACP. The test runs the
// composition root of the main process (`composeMain`), as `src/app/main/composition.test.ts` does,
// with the ACP port and the launch recipe of Claude Code, whose program is the simulated agent. It
// calls each contract by name through `createInvoke`, as the window does, and reads the events that
// the composition publishes. So it fixes no handler and no deps of a slice. The product has no test
// hook. Coordinator precedent (S9): locked vitest tests live in this folder, because
// `tsconfig.main.json` typechecks it.
//
// The interface that this test reads. Each name comes from the spec (sections "Interfaces" and "Data"):
// - The contract `sessions.answer-permission`: input `{ id, requestId, optionId }`, result `{}`,
//   errors `unknown-session`, `unknown-request`, `unknown-option`.
// - The contract `sessions.answer-elicitation`: input `{ id, elicitationId, answer }` with the answer
//   `{ action: 'submit', values }` or `{ action: 'skip' }`; errors `unknown-session`,
//   `unknown-request`, `invalid-answer`.
// - The snapshot of `sessions.open`: `permissions: PermissionView[]` and `elicitations:
//   ElicitationView[]` in the order of arrival, and `liveMode: Mode | null`. `PermissionView` is
//   `{ id, entryId, toolId, title, toolKind, locations, options }`; `ElicitationView` is
//   `{ id, entryId, toolId, message, fields }`.
// - The changes of `sessions.changed`: `{ type: 'card-opened', entry, card: { kind: 'permission',
//   permission } | { kind: 'elicitation', elicitation } }`, `{ type: 'card-closed', entry, id }`,
//   `{ type: 'mode', mode }` and `{ type: 'model', model }`.
// - The entry kind `answers` (approved format): `{ kind: 'answers', card: 'decision' | 'question',
//   toolId, outcome, rows: [{ question, answer }] }`, saved with the outcome `open` when the card opens
//   and replaced in place (same ID, same position) when it closes.
// - `Composition.shutdown()` is the quit path of Aether (`src/main/index.ts`).
// - Each of these names, as the spec gives it: the question text "Run this command?" of a decision
//   card for the tool kind `execute`, and the answer "Answered" of a text field in a form that is not
//   AskUserQuestion.
//
// No test sleeps. A test waits on a report of the simulated agent, or polls the published events with
// a time limit and a message.
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GithubPort, GithubTokenPort } from '../../src/building-blocks/github.port'
import { err, ok } from '../../src/building-blocks/result'
import { contracts } from '../../src/app/contracts'
import { composeMain, DATABASE_FILE, type Composition } from '../../src/app/main/composition'
import { createInvoke } from '../../src/app/main/ipc'
import { AcpAgents } from '../../src/providers/acp/acp-agents'
import { claudeCodeRecipe } from '../../src/providers/claude-code/claude-code'
import { ControlServer, type AcpMessage, type PermissionAnswer, type ElicitationAnswer } from '../simulated-agent/control'

/** A test with real agent processes needs more than the 5 s of vitest. */
const TIME_LIMIT = 60_000
/** The longest wait for one event or one report. */
const WAIT = 10_000

const RUN = { id: 'run-tests', title: 'npm test', kind: 'execute' }
const READ = { id: 'read-log', title: 'Read last-run.txt', kind: 'read' }
const RUN_QUESTION = 'Run this command?'

// The shapes of the spec, as this test reads them.
interface EntryView {
  id: string
  entry: { kind: string; [key: string]: unknown }
}
interface AnswersEntry {
  kind: 'answers'
  card: 'decision' | 'question'
  toolId: string | null
  outcome: string
  rows: { question: string; answer: string | null }[]
}
interface PermissionView {
  id: string
  entryId: string
  toolId: string
  options: { id: string; label: string; kind: string }[]
}
interface ElicitationView {
  id: string
  entryId: string
  toolId: string | null
  message: string
}
interface Snapshot {
  session: { mode: string; model: string }
  entries: EntryView[]
  status: string
  revision: number
  permissions?: PermissionView[]
  elicitations?: ElicitationView[]
  liveMode?: string | null
}
interface Change {
  type: string
  entry?: EntryView
  card?: { kind: 'permission'; permission: PermissionView } | { kind: 'elicitation'; elicitation: ElicitationView }
  id?: string
  status?: string
  mode?: string
  model?: string
}
interface SessionEvent {
  sessionId: string
  revision: number
  change: Change
}
type Answer = { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }

const github: GithubPort & GithubTokenPort = {
  listAccounts: async () => err('github-cli-missing', 'No gh.'),
  tokenOf: async (login) => ok(`fake-token-of-${login}`)
}

let base: string
let dataDir: string
let rootDir: string
let control: ControlServer
let running: Composition[]
let published: SessionEvent[]
let logged: string[]

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'aether-s5-slice-'))
  dataDir = join(base, 'data')
  rootDir = join(base, 'directories')
  await mkdir(dataDir)
  await mkdir(rootDir)
  control = await ControlServer.start()
  running = []
  published = []
  logged = []
})

afterEach(async () => {
  for (const composition of running) {
    await composition.shutdown().catch(() => undefined)
    composition.close()
  }
  for (const pid of control.pids) if (isRunning(pid)) process.kill(pid)
  await control.close()
  await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}, TIME_LIMIT)

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Starts the main process of Aether on the data folder: the composition root and `invoke`, as the app does. */
function startMain() {
  const agents = new AcpAgents({
    recipe: claudeCodeRecipe({ override: async () => ok(control.agent) }),
    environment: () => ({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot })
  })
  const composed = composeMain({
    dataDir,
    github,
    agents,
    publish: (name, payload) => {
      if (name === 'sessions.changed') published.push(payload as SessionEvent)
    },
    log: (message, cause) => logged.push(`${message} ${String(cause)}`)
  })
  if (!composed.ok) throw new Error(`${composed.error.code}: ${composed.error.message}`)
  const composition = composed.value
  running.push(composition)
  const invoke = createInvoke({
    contracts,
    controllers: composition.controllers,
    isTrusted: () => true,
    log: (message, cause) => logged.push(`${message} ${String(cause)}`)
  })
  const call = (name: string, input: unknown) =>
    invoke({ sender: { id: 1, send: () => undefined, isDestroyed: () => false } }, name, input) as Promise<Answer>
  return { composition, call }
}

type Main = ReturnType<typeof startMain>

/** Ends a composition as a quit does: the shutdown, then the database closes. */
async function quit(main: Main): Promise<void> {
  await main.composition.shutdown()
  main.composition.close()
  running = running.filter((composition) => composition !== main.composition)
}

/** The value of an answer, or a failure that names the check and the error. */
function valueOf<T>(answer: Answer, check: string, what: string): T {
  if (!answer.ok) throw new Error(`${check}: ${what} failed with ${answer.error.code}: ${answer.error.message}`)
  return answer.value as T
}

/** Adds the profile "Personal" with the workspace directory, and creates a session in it. Returns the session ID. */
async function createSession(main: Main, check: string, settings: { mode?: string; model?: string } = {}): Promise<string> {
  valueOf(await main.call('profiles.add', { name: 'Personal', workspaceDirectory: rootDir, github: null, claudeFolder: null }), check, 'profiles.add')
  const profiles = valueOf<{ profiles: { id: string }[] }>(await main.call('profiles.list', {}), check, 'profiles.list')
  const created = valueOf<{ id: string }>(
    await main.call('sessions.create', {
      profileId: profiles.profiles[0]!.id,
      prompt: 'Run the tests',
      mode: settings.mode ?? 'ask',
      model: settings.model ?? 'default',
      sourcePath: rootDir,
      attachments: []
    }),
    check,
    'sessions.create'
  )
  return created.id
}

async function send(main: Main, id: string, text: string, check: string): Promise<void> {
  expect(await main.call('sessions.send-message', { id, text }), `${check}: Aether did not accept the message "${text}".`).toEqual({ ok: true, value: {} })
}

async function snapshotOf(main: Main, id: string, check: string): Promise<Snapshot> {
  return valueOf<Snapshot>(await main.call('sessions.open', { id }), check, 'sessions.open')
}

/** The changes of one session, in the order of their revisions. */
const changesOf = (id: string) => published.filter((event) => event.sessionId === id).map((event) => event.change)

/** Waits until the session has `count` changes that match, and returns them. */
async function waitForChanges(id: string, match: (change: Change) => boolean, count: number, message: string): Promise<Change[]> {
  await expect.poll(() => changesOf(id).filter(match).length, { timeout: WAIT, message }).toBeGreaterThanOrEqual(count)
  return changesOf(id).filter(match)
}

const isOpened = (change: Change) => change.type === 'card-opened'
const isClosed = (change: Change) => change.type === 'card-closed'
const isIdle = (change: Change) => change.type === 'status' && change.status === 'idle'

/** Waits for `count` open cards and returns the changes `card-opened`. */
const waitForOpened = (id: string, count: number, check: string, what = 'the open request') =>
  waitForChanges(id, isOpened, count, `${check}: the agent asked, but no change "card-opened" came for ${what}.`)

/** The permission of a change `card-opened`. */
function permissionOf(change: Change, check: string): PermissionView {
  if (change.card?.kind !== 'permission') throw new Error(`${check}: the change card-opened carries no permission: ${JSON.stringify(change)}`)
  return change.card.permission
}

/** The elicitation of a change `card-opened`. */
function elicitationOf(change: Change, check: string): ElicitationView {
  if (change.card?.kind !== 'elicitation') throw new Error(`${check}: the change card-opened carries no elicitation: ${JSON.stringify(change)}`)
  return change.card.elicitation
}

/** The `answers` entries of a snapshot, in order. */
const answersOf = (snapshot: Snapshot) => snapshot.entries.filter((view) => view.entry.kind === 'answers')

/** A report of the simulated agent, with a time limit. */
async function reach<T>(promise: Promise<T>, message: string): Promise<T> {
  let done = false
  let value: T | undefined
  void promise.then((result) => {
    value = result
    done = true
  })
  await expect.poll(() => done, { timeout: WAIT, message }).toBe(true)
  return value as T
}

const waitForPermission = (id: string, check: string): Promise<PermissionAnswer> =>
  reach(control.waitForPermission(id), `${check}: the agent got no answer to the permission request "${id}".`)
const waitForElicitation = (id: string, check: string): Promise<ElicitationAnswer> =>
  reach(control.waitForElicitation(id), `${check}: the agent got no answer to the elicitation "${id}".`)

/** The rows of the database table `entries` of a session, read from the file while Aether runs. */
function savedEntries(sessionId: string): { id: string; position: number; data: AnswersEntry & Record<string, unknown> }[] {
  const database = new DatabaseSync(join(dataDir, DATABASE_FILE), { readOnly: true })
  try {
    return database
      .prepare('SELECT id, position, data FROM entries WHERE session_id = ? ORDER BY position')
      .all(sessionId)
      .map((row) => ({ id: String(row.id), position: Number(row.position), data: JSON.parse(String(row.data)) as AnswersEntry & Record<string, unknown> }))
  } finally {
    database.close()
  }
}

/** Every value of every row of the database, as text, to search for a secret. */
function databaseText(): string {
  const database = new DatabaseSync(join(dataDir, DATABASE_FILE), { readOnly: true })
  try {
    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => String(row.name))
    return tables.map((table) => JSON.stringify(database.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}"`).all())).join('\n')
  } finally {
    database.close()
  }
}

const scenario = (prompt: unknown[]) => control.scenario('steps', { prompt })
const ask = (...requests: object[]) => ({ do: 'ask', requests })
const answers = { do: 'answers' }
const gate = (name: string) => ({ do: 'gate', name })
const say = (text: string) => ({ do: 'say', text })

/** One AskUserQuestion question with two options, as the Claude Code adapter sends it (`elicitation.js`). */
const askOne = (toolCallId: string, text: string) => ({
  mode: 'form',
  toolCallId,
  message: text,
  requestedSchema: {
    type: 'object',
    properties: {
      question_0: {
        type: 'string',
        title: 'Runner',
        oneOf: [
          { const: 'Vitest', title: 'Vitest', description: 'Fast.' },
          { const: 'Jest', title: 'Jest', description: 'Widely used.' }
        ]
      },
      question_0_custom: { type: 'string', title: 'Other', description: 'Type your own answer, or add a note to the option you chose above (optional).' }
    }
  }
})

describe('S5-30 and S5-32: the entry of a card and the changes that carry it', () => {
  it(
    'S5-30: a card saves its answers entry with the outcome open at once, the snapshot pairs it with its request, and the answer replaces the same entry in place',
    async () => {
      const check = 'S5-30'
      await scenario([ask(RUN), answers, say('Done.')])
      const main = startMain()
      const id = await createSession(main, check)
      await send(main, id, 'Run the tests', check)
      const [opened] = await waitForOpened(id, 1, check)
      const permission = permissionOf(opened!, check)
      const entry = opened!.entry!
      expect(entry.entry, `${check}: the card must save the entry "answers" with the outcome open and one row with no answer.`).toEqual({
        kind: 'answers',
        card: 'decision',
        toolId: RUN.id,
        outcome: 'open',
        rows: [{ question: RUN_QUESTION, answer: null }]
      })
      expect(permission.entryId, `${check}: the request must name its entry with entryId.`).toBe(entry.id)
      expect(permission.toolId, `${check}: the request must name its tool call.`).toBe(RUN.id)

      // Saved at once: the database holds the entry while the card is open.
      const saved = savedEntries(id)
      const row = saved.find((item) => item.id === entry.id)
      expect(row?.data.outcome, `${check}: the database must hold the entry of the open card with the outcome open.`).toBe('open')
      const snapshot = await snapshotOf(main, id, check)
      expect(snapshot.permissions?.map((item) => [item.id, item.entryId]), `${check}: the snapshot must hold the open request with its entryId.`).toEqual([
        [permission.id, entry.id]
      ])
      const index = snapshot.entries.findIndex((item) => item.id === entry.id)
      expect(index, `${check}: the snapshot must hold the entry of the open card.`).toBeGreaterThanOrEqual(0)

      // The answer replaces the same entry, at the same place.
      expect(await main.call('sessions.answer-permission', { id, requestId: permission.id, optionId: 'yes' }), `${check}: the answer must be accepted.`).toEqual({
        ok: true,
        value: {}
      })
      expect(await waitForPermission(RUN.id, check), `${check}: the agent must get "Allow".`).toEqual({ id: RUN.id, outcome: { outcome: 'selected', optionId: 'yes' } })
      const [closed] = await waitForChanges(id, isClosed, 1, `${check}: no change "card-closed" came after the answer.`)
      expect(closed!.id, `${check}: card-closed must name the request.`).toBe(permission.id)
      expect(closed!.entry?.id, `${check}: card-closed must carry the same entry ID.`).toBe(entry.id)
      expect(closed!.entry?.entry, `${check}: the answer must replace the entry with the outcome submitted and the label of the option.`).toEqual({
        kind: 'answers',
        card: 'decision',
        toolId: RUN.id,
        outcome: 'submitted',
        rows: [{ question: RUN_QUESTION, answer: 'Allow' }]
      })
      await waitForChanges(id, isIdle, 1, `${check}: the turn does not end.`)
      const after = await snapshotOf(main, id, check)
      expect(after.entries[index]?.id, `${check}: the answered entry must keep its position in the snapshot.`).toBe(entry.id)
      expect((after.entries[index]?.entry as unknown as AnswersEntry).outcome, `${check}: the snapshot must show the outcome submitted.`).toBe('submitted')
      expect(after.permissions, `${check}: the answered request must leave the snapshot.`).toEqual([])
      const replaced = savedEntries(id).find((item) => item.id === entry.id)
      expect(replaced?.position, `${check}: the database must keep the position of the entry.`).toBe(row?.position)
      expect(replaced?.data.outcome, `${check}: the database must hold the outcome submitted.`).toBe('submitted')
      expect(savedEntries(id).filter((item) => item.data.kind === 'answers'), `${check}: the answer must not add a second entry.`).toHaveLength(1)
    },
    TIME_LIMIT
  )

  it(
    'S5-32: card-opened carries the open entry and its request together, card-closed the replaced entry and the request ID together, and no other change carries an answers entry',
    async () => {
      const check = 'S5-32'
      await scenario([ask(RUN, READ), answers, say('Done.')])
      const main = startMain()
      const id = await createSession(main, check)
      await send(main, id, 'Run the tests', check)
      const opened = await waitForOpened(id, 2, check, 'both requests')
      for (const change of opened) {
        const permission = permissionOf(change, check)
        expect((change.entry?.entry as unknown as AnswersEntry | undefined)?.outcome, `${check}: card-opened must carry its entry with the outcome open.`).toBe('open')
        expect(permission.entryId, `${check}: card-opened must carry the request of its entry.`).toBe(change.entry?.id)
      }
      // The view after the two changes: each open entry has its live request.
      const view = await snapshotOf(main, id, check)
      for (const entry of answersOf(view)) {
        expect(view.permissions?.some((permission) => permission.entryId === entry.id), `${check}: the snapshot holds an open entry with no live request.`).toBe(true)
      }

      for (const change of opened) {
        const permission = permissionOf(change, check)
        valueOf(await main.call('sessions.answer-permission', { id, requestId: permission.id, optionId: 'no' }), check, 'sessions.answer-permission')
      }
      const closed = await waitForChanges(id, isClosed, 2, `${check}: no change "card-closed" came for each answer.`)
      expect(closed.map((change) => change.id), `${check}: each card-closed must name its request.`).toEqual(opened.map((change) => permissionOf(change, check).id))
      expect(closed.map((change) => change.entry?.id), `${check}: each card-closed must carry the entry of its request.`).toEqual(opened.map((change) => change.entry?.id))
      await waitForChanges(id, isIdle, 1, `${check}: the turn does not end.`)
      const after = await snapshotOf(main, id, check)
      expect(after.permissions, `${check}: after card-closed, the snapshot must hold no request.`).toEqual([])
      expect(answersOf(after).map((view) => (view.entry as unknown as AnswersEntry).outcome), `${check}: after card-closed, each entry must have its final outcome.`).toEqual([
        'submitted',
        'submitted'
      ])

      // Only the two changes of a card carry an answers entry. The revisions have no gap.
      const others = changesOf(id).filter((change) => change.entry?.entry.kind === 'answers' && !isOpened(change) && !isClosed(change))
      expect(others, `${check}: another change carries an answers entry, so the window could see the entry without its request.`).toEqual([])
      const revisions = published.filter((event) => event.sessionId === id).map((event) => event.revision)
      expect(revisions, `${check}: the cards and the entries must share one revision sequence, with no gap.`).toEqual(revisions.map((_, index) => revisions[0]! + index))
    },
    TIME_LIMIT
  )
})

describe('S5-2, S5-3, S5-4 and S5-29: one request at a time', () => {
  it(
    'S5-2: the agent withdraws one of two requests, and only that card closes, as withdrawn',
    async () => {
      const check = 'S5-2'
      await scenario([ask(RUN, READ), gate('withdraw'), { do: 'withdraw', id: RUN.id }, answers, say('Done.')])
      const main = startMain()
      const id = await createSession(main, check)
      await send(main, id, 'Run the tests', check)
      const opened = await waitForOpened(id, 2, check, 'both requests')
      await reach(control.waitForGate('withdraw'), `${check}: the agent did not reach the withdraw.`)
      await control.open('withdraw')
      const [closed] = await waitForChanges(id, isClosed, 1, `${check}: the agent withdrew a request, but no change "card-closed" came.`)
      const [first, second] = opened.map((change) => permissionOf(change, check)) as [PermissionView, PermissionView]
      expect(closed!.id, `${check}: only the withdrawn request must close.`).toBe(first.id)
      expect((closed!.entry?.entry as unknown as AnswersEntry).outcome, `${check}: the withdrawn card must save the outcome withdrawn.`).toBe('withdrawn')
      const snapshot = await snapshotOf(main, id, check)
      expect(snapshot.permissions?.map((permission) => permission.id), `${check}: the other request must stay open.`).toEqual([second.id])

      // The other card still takes its answer.
      valueOf(await main.call('sessions.answer-permission', { id, requestId: second.id, optionId: 'yes' }), check, 'sessions.answer-permission')
      expect(await waitForPermission(READ.id, check)).toEqual({ id: READ.id, outcome: { outcome: 'selected', optionId: 'yes' } })
      await waitForChanges(id, isIdle, 1, `${check}: the turn does not end.`)
      expect(changesOf(id).filter(isClosed).map((change) => change.id), `${check}: each card must close once.`).toEqual([first.id, second.id])
    },
    TIME_LIMIT
  )

  it(
    'S5-3: an answer with an unknown request ID or with an option that the request did not offer fails, and the agent gets nothing',
    async () => {
      const check = 'S5-3'
      await scenario([ask(RUN), answers, say('Done.')])
      const main = startMain()
      const id = await createSession(main, check)
      await send(main, id, 'Run the tests', check)
      const [opened] = await waitForOpened(id, 1, check)
      const permission = permissionOf(opened!, check)

      const unknownRequest = await main.call('sessions.answer-permission', { id, requestId: 'no-such-request', optionId: 'yes' })
      expect(unknownRequest, `${check}: an unknown request ID must fail with unknown-request.`).toMatchObject({ ok: false, error: { code: 'unknown-request' } })
      const unknownOption = await main.call('sessions.answer-permission', { id, requestId: permission.id, optionId: 'not-offered' })
      expect(unknownOption, `${check}: an option that the request did not offer must fail with unknown-option.`).toMatchObject({
        ok: false,
        error: { code: 'unknown-option' }
      })
      const unknownSession = await main.call('sessions.answer-permission', { id: 'no-such-session', requestId: permission.id, optionId: 'yes' })
      expect(unknownSession, `${check}: an unknown session must fail with unknown-session.`).toMatchObject({ ok: false, error: { code: 'unknown-session' } })
      expect(control.permissionAnswers, `${check}: a refused answer reached the agent.`).toEqual([])
      const snapshot = await snapshotOf(main, id, check)
      expect(snapshot.permissions?.map((item) => item.id), `${check}: a refused answer closed the request.`).toEqual([permission.id])
      expect(changesOf(id).filter(isClosed), `${check}: a refused answer closed the card.`).toEqual([])

      valueOf(await main.call('sessions.answer-permission', { id, requestId: permission.id, optionId: 'yes' }), check, 'sessions.answer-permission')
      expect(await waitForPermission(RUN.id, check), `${check}: the valid answer must still reach the agent.`).toEqual({
        id: RUN.id,
        outcome: { outcome: 'selected', optionId: 'yes' }
      })
    },
    TIME_LIMIT
  )

  it(
    'S5-4: the agent process exits while two requests are open, and both cards close, as exited',
    async () => {
      const check = 'S5-4'
      await scenario([ask(RUN, READ), gate('never')])
      const main = startMain()
      const id = await createSession(main, check)
      await send(main, id, 'Run the tests', check)
      await waitForOpened(id, 2, check, 'both requests')
      const [pid] = control.pids as [number]
      process.kill(pid)
      const closed = await waitForChanges(id, isClosed, 2, `${check}: the agent process exited, but no change "card-closed" came for both cards.`)
      expect(closed.map((change) => (change.entry?.entry as unknown as AnswersEntry).outcome), `${check}: both cards must save the outcome exited.`).toEqual([
        'exited',
        'exited'
      ])
      await waitForChanges(id, isIdle, 1, `${check}: the turn does not end after the exit.`)
      const snapshot = await snapshotOf(main, id, check)
      expect(snapshot.permissions, `${check}: after the exit, the snapshot must hold no open request.`).toEqual([])
    },
    TIME_LIMIT
  )

  it(
    'S5-29: Stop on a card also makes the agent withdraw it, and the card keeps the reason stopped: the first close wins',
    async () => {
      const check = 'S5-29'
      await scenario([{ do: 'ask', withdrawOnCancel: true, requests: [RUN] }, answers, say('Not sent.')])
      const main = startMain()
      const id = await createSession(main, check)
      await send(main, id, 'Run the tests', check)
      const [opened] = await waitForOpened(id, 1, check)
      const permission = permissionOf(opened!, check)
      valueOf(await main.call('sessions.stop', { id }), check, 'sessions.stop')
      expect(await waitForPermission(RUN.id, check), `${check}: the agent must get cancelled after Stop.`).toEqual({ id: RUN.id, outcome: { outcome: 'cancelled' } })
      await waitForChanges(id, isIdle, 1, `${check}: the turn does not end after Stop.`)
      // The agent withdrew the request after session/cancel (withdrawOnCancel), as the Claude Code adapter does.
      const closed = changesOf(id).filter(isClosed)
      expect(closed.map((change) => change.id), `${check}: the card must close exactly once.`).toEqual([permission.id])
      expect((closed[0]!.entry?.entry as unknown as AnswersEntry).outcome, `${check}: the card closed by Stop must keep the reason stopped.`).toBe('stopped')
      expect(control.permissionAnswers, `${check}: the agent must get exactly one answer.`).toHaveLength(1)
      const snapshot = await snapshotOf(main, id, check)
      expect(answersOf(snapshot).map((view) => (view.entry as unknown as AnswersEntry).outcome), `${check}: the saved entry must keep stopped.`).toEqual(['stopped'])
    },
    TIME_LIMIT
  )
})

describe('S5-5: a request when no turn runs', () => {
  it(
    'S5-5: a request after the turn shows a card, Stop cancels it, and the agent receives cancelled',
    async () => {
      const check = 'S5-5'
      const background = { id: 'build', title: 'npm run build', kind: 'execute' }
      await scenario([say('I start a background task.'), { do: 'detach', steps: [gate('later'), ask(background), answers] }])
      const main = startMain()
      const id = await createSession(main, check)
      await send(main, id, 'Build in the background', check)
      await waitForChanges(id, isIdle, 1, `${check}: the turn does not end.`)
      await control.open('later')
      const [opened] = await waitForOpened(id, 1, check, 'the request outside a turn')
      const permission = permissionOf(opened!, check)
      const snapshot = await snapshotOf(main, id, check)
      expect(snapshot.status, `${check}: no turn runs, so the status stays idle.`).toBe('idle')
      expect(snapshot.permissions?.map((item) => item.id), `${check}: the snapshot must hold the request outside a turn.`).toEqual([permission.id])

      valueOf(await main.call('sessions.stop', { id }), check, 'sessions.stop')
      expect(await waitForPermission(background.id, check), `${check}: Stop with no turn must answer cancelled to the agent.`).toEqual({
        id: background.id,
        outcome: { outcome: 'cancelled' }
      })
      const [closed] = await waitForChanges(id, isClosed, 1, `${check}: Stop with no turn did not close the card.`)
      expect((closed!.entry?.entry as unknown as AnswersEntry).outcome, `${check}: the card must save the outcome stopped.`).toBe('stopped')
    },
    TIME_LIMIT
  )
})

describe('S5-8 and S5-16: the live mode', () => {
  /** The Claude modes that one agent process got before its first prompt. */
  const modesBeforePrompt = (pid: number) => {
    const messages = control.processMessages.filter((entry) => entry.pid === pid).map(({ message }) => message)
    const index = messages.findIndex((message) => message.method === 'session/prompt')
    return (index < 0 ? messages : messages.slice(0, index))
      .filter((message: AcpMessage) => message.method === 'session/set_mode')
      .map((message) => (message.params as { modeId?: unknown }).modeId)
  }

  it(
    'S5-8: the agent reports bypassPermissions; the session shows Approve all, the saved mode stays the last saved mode, and a new process starts in that mode',
    async () => {
      const check = 'S5-8'
      await scenario([
        { do: 'update', update: { sessionUpdate: 'current_mode_update', currentModeId: 'acceptEdits' } },
        { do: 'update', update: { sessionUpdate: 'current_mode_update', currentModeId: 'bypassPermissions' } },
        say('Done.')
      ])
      let main = startMain()
      const id = await createSession(main, check, { mode: 'ask' })
      await send(main, id, 'Run the tests', check)
      await waitForChanges(id, isIdle, 1, `${check}: the turn does not end.`)
      const modes = changesOf(id).filter((change) => change.type === 'mode').map((change) => change.mode)
      expect(modes, `${check}: the session must send the change "mode" for each mode that the agent reports.`).toEqual(['accept-edits', 'approve-all'])
      const snapshot = await snapshotOf(main, id, check)
      expect(snapshot.liveMode, `${check}: the snapshot must show the live mode Approve all.`).toBe('approve-all')
      expect(snapshot.session.mode, `${check}: Approve all is never saved: the saved mode must stay the last saved mode, accept-edits.`).toBe('accept-edits')

      // A new process starts in the saved mode.
      await quit(main)
      main = startMain()
      await control.scenario('text', { chunks: ['Welcome ', 'back.'] })
      const restarted = await snapshotOf(main, id, check)
      expect(restarted.session.mode, `${check}: after a restart, the saved mode must be accept-edits.`).toBe('accept-edits')
      await send(main, id, 'Go on', check)
      await expect.poll(() => control.pids.length, { timeout: WAIT, message: `${check}: the next message started no new process.` }).toBe(2)
      await expect
        .poll(() => control.receivedBy('session/prompt').filter((entry) => entry.pid === control.pids[1]).length, { timeout: WAIT, message: `${check}: the new process got no prompt.` })
        .toBe(1)
      expect(modesBeforePrompt(control.pids[1]!).at(-1), `${check}: the new process must start in the saved mode acceptEdits, not in bypassPermissions.`).toBe('acceptEdits')
    },
    TIME_LIMIT
  )

  it(
    'S5-16: with the notice of the Auto fallback, the session shows Accept edits, the saved mode stays auto, and the notice shows again at the next start',
    async () => {
      const check = 'S5-16'
      await control.scenario('no-auto', { models: ['claude-haiku-5-5'], chunks: ['Hello ', 'from the agent.'] })
      let main = startMain()
      const id = await createSession(main, check, { mode: 'auto', model: 'claude-haiku-5-5' })
      await send(main, id, 'Say hello', check)
      await waitForChanges(id, isIdle, 1, `${check}: the turn does not end.`)
      const notices = (snapshot: Snapshot) => snapshot.entries.filter((view) => view.entry.kind === 'notice' && view.entry.code === 'auto-fallback')
      const first = await snapshotOf(main, id, check)
      expect(notices(first), `${check}: the S7 notice of the Auto fallback must show.`).toHaveLength(1)
      expect(changesOf(id).filter((change) => change.type === 'mode').map((change) => change.mode), `${check}: the session must send the live mode accept-edits.`).toEqual([
        'accept-edits'
      ])
      expect(first.liveMode, `${check}: the snapshot must show the live mode Accept edits.`).toBe('accept-edits')
      expect(first.session.mode, `${check}: with the notice of the Auto fallback, the saved mode must stay auto.`).toBe('auto')

      await quit(main)
      main = startMain()
      await send(main, id, 'Say hello again', check)
      await expect.poll(async () => notices(await snapshotOf(main, id, check)).length, { timeout: WAIT, message: `${check}: the notice does not show again at the next start.` }).toBe(2)
      await expect.poll(() => control.pids.length, { timeout: WAIT }).toBe(2)
      expect(modesBeforePrompt(control.pids[1]!).at(-1), `${check}: the next start must ask for auto again.`).toBe('auto')
      expect((await snapshotOf(main, id, check)).session.mode, `${check}: the saved mode must stay auto.`).toBe('auto')
    },
    TIME_LIMIT
  )
})

describe('S5-11, S5-12 and S5-25: elicitations', () => {
  it(
    'S5-11: "Skip" sends decline, and Stop sends cancel for an open question card',
    async () => {
      const check = 'S5-11'
      await scenario([
        { do: 'elicit', id: 'first', request: askOne('ask-1', 'Which test runner do you want?') },
        answers,
        { do: 'elicit', id: 'second', request: askOne('ask-2', 'Which test runner for the e2e tests?') },
        answers,
        say('Not sent.')
      ])
      const main = startMain()
      const id = await createSession(main, check)
      await send(main, id, 'Set up the tests', check)
      const [opened] = await waitForOpened(id, 1, check, 'the question')
      const first = elicitationOf(opened!, check)
      expect(first.message, `${check}: the elicitation must carry the message of the agent.`).toBe('Which test runner do you want?')
      expect(await main.call('sessions.answer-elicitation', { id, elicitationId: first.id, answer: { action: 'skip' } }), `${check}: "Skip" must be accepted.`).toEqual({
        ok: true,
        value: {}
      })
      expect(await waitForElicitation('first', check), `${check}: "Skip" must send decline.`).toEqual({ id: 'first', response: { action: 'decline' } })

      const opens = await waitForOpened(id, 2, check, 'the second question')
      elicitationOf(opens[1]!, check)
      valueOf(await main.call('sessions.stop', { id }), check, 'sessions.stop')
      expect(await waitForElicitation('second', check), `${check}: Stop must send cancel for the open question.`).toEqual({ id: 'second', response: { action: 'cancel' } })
      const closed = await waitForChanges(id, isClosed, 2, `${check}: the question cards did not close.`)
      expect(closed.map((change) => (change.entry?.entry as unknown as AnswersEntry).outcome), `${check}: the cards must save skipped, then stopped.`).toEqual([
        'skipped',
        'stopped'
      ])
      expect((closed[0]!.entry?.entry as unknown as AnswersEntry).card, `${check}: a question card saves card "question".`).toBe('question')
    },
    TIME_LIMIT
  )

  it(
    'S5-12: a form with a number field gets the error -32602, and no card shows',
    async () => {
      const check = 'S5-12'
      const request = { mode: 'form', message: 'How many workers?', requestedSchema: { type: 'object', properties: { workers: { type: 'number', title: 'Workers' } } } }
      await scenario([{ do: 'elicit', id: 'workers', request }, answers, say('Done.')])
      const main = startMain()
      const id = await createSession(main, check)
      await send(main, id, 'Set up the tests', check)
      const answer = await waitForElicitation('workers', check)
      expect(answer.error?.code, `${check}: a form with a number field must get the JSON-RPC error -32602, but the agent got ${JSON.stringify(answer)}.`).toBe(-32602)
      await waitForChanges(id, isIdle, 1, `${check}: the turn does not end.`)
      expect(changesOf(id).filter(isOpened), `${check}: a form that Aether cannot render must show no card.`).toEqual([])
      expect(answersOf(await snapshotOf(main, id, check)), `${check}: a form that got -32602 must save no entry.`).toEqual([])
    },
    TIME_LIMIT
  )

  it(
    'S5-25: an MCP form with a text field saves "Answered", not the typed text',
    async () => {
      const check = 'S5-25'
      const secret = 'fake-secret-value-0425'
      const request = {
        mode: 'form',
        message: 'The example service needs a token.',
        requestedSchema: { type: 'object', properties: { token: { type: 'string', title: 'Token', description: 'Paste the token of the example service.' } } }
      }
      await scenario([{ do: 'elicit', id: 'token', request }, answers, say('Connected.')])
      const main = startMain()
      const id = await createSession(main, check)
      await send(main, id, 'Connect the service', check)
      const [opened] = await waitForOpened(id, 1, check, 'the MCP form')
      const form = elicitationOf(opened!, check)
      expect(form.toolId, `${check}: an MCP form has no tool call.`).toBeNull()
      valueOf(
        await main.call('sessions.answer-elicitation', { id, elicitationId: form.id, answer: { action: 'submit', values: { token: secret } } }),
        check,
        'sessions.answer-elicitation'
      )
      expect(await waitForElicitation('token', check), `${check}: the agent must receive the typed text.`).toEqual({
        id: 'token',
        response: { action: 'accept', content: { token: secret } }
      })
      const [closed] = await waitForChanges(id, isClosed, 1, `${check}: the MCP form did not close after the answer.`)
      const entry = closed!.entry?.entry as unknown as AnswersEntry
      expect(entry.outcome, `${check}: the MCP form must save the outcome submitted.`).toBe('submitted')
      expect(entry.rows.map((row) => row.answer), `${check}: the text field of an MCP form must save "Answered".`).toEqual(['Answered'])
      await waitForChanges(id, isIdle, 1, `${check}: the turn does not end.`)
      expect(databaseText().includes(secret), `${check}: the database holds the typed text of the MCP form.`).toBe(false)
    },
    TIME_LIMIT
  )
})

describe('S5-28: the reason of each close', () => {
  it(
    'S5-28: withdraw, Skip, Stop, the exit of the process and the quit of Aether each save their reason, also after a restart',
    async () => {
      const check = 'S5-28'
      const A = { id: 'edit-a', title: 'Edit a.txt', kind: 'edit' }
      const B = { id: 'edit-b', title: 'Edit b.txt', kind: 'edit' }
      await scenario([
        ask(A, B),
        { do: 'elicit', id: 'runner', request: askOne('ask-1', 'Which test runner do you want?') },
        gate('withdraw'),
        { do: 'withdraw', id: A.id },
        gate('never')
      ])
      let main = startMain()
      const id = await createSession(main, check)
      await send(main, id, 'Edit the files', check)
      const opened = await waitForOpened(id, 3, check, 'the two requests and the question')
      await control.open('withdraw')
      await waitForChanges(id, isClosed, 1, `${check}: the withdraw did not close the card.`)
      const question = elicitationOf(opened[2]!, check)
      valueOf(await main.call('sessions.answer-elicitation', { id, elicitationId: question.id, answer: { action: 'skip' } }), check, 'sessions.answer-elicitation')
      await waitForChanges(id, isClosed, 2, `${check}: "Skip" did not close the question card.`)
      valueOf(await main.call('sessions.stop', { id }), check, 'sessions.stop')
      await waitForChanges(id, isClosed, 3, `${check}: Stop did not close the open card.`)
      await waitForChanges(id, isIdle, 1, `${check}: the turn does not end after Stop.`)

      // The exit of the process.
      await scenario([ask({ id: 'run-c', title: 'npm test', kind: 'execute' }), gate('never')])
      await send(main, id, 'Run the tests', check)
      await waitForOpened(id, 4, check, 'the request of the second turn')
      process.kill(control.pids[0]!)
      await waitForChanges(id, isClosed, 4, `${check}: the exit of the agent did not close the card.`)
      await waitForChanges(id, isIdle, 2, `${check}: the turn does not end after the exit.`)

      // The quit of Aether.
      await scenario([ask({ id: 'run-d', title: 'npm run lint', kind: 'execute' }), gate('never')])
      await send(main, id, 'Run the linter', check)
      await waitForOpened(id, 5, check, 'the request of the third turn')
      await quit(main)

      main = startMain()
      const snapshot = await snapshotOf(main, id, check)
      expect(answersOf(snapshot).map((view) => (view.entry as unknown as AnswersEntry).outcome), `${check}: after a restart, each card must keep the reason of its close, in order.`).toEqual([
        'withdrawn',
        'stopped',
        'skipped',
        'exited',
        'quit'
      ])
      expect(snapshot.permissions ?? [], `${check}: after a restart, no request is open.`).toEqual([])
    },
    TIME_LIMIT
  )

  it(
    'S5-28: Delete session with an open card saves no entry, and the agent gets cancelled',
    async () => {
      const check = 'S5-28 (delete)'
      await scenario([ask(RUN), answers, say('Not sent.')])
      const main = startMain()
      const id = await createSession(main, check)
      await send(main, id, 'Run the tests', check)
      await waitForOpened(id, 1, check)
      valueOf(await main.call('sessions.delete', { id }), check, 'sessions.delete')
      expect(await waitForPermission(RUN.id, check), `${check}: the agent must get cancelled when the session is deleted.`).toEqual({
        id: RUN.id,
        outcome: { outcome: 'cancelled' }
      })
      expect(savedEntries(id), `${check}: a deleted session must keep no entry.`).toEqual([])
      expect(logged, `${check}: the delete of a session with an open card logged a failure.`).toEqual([])
    },
    TIME_LIMIT
  )
})
