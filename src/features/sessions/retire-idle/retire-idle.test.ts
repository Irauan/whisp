import { describe, expect, it } from 'vitest'
import type { AgentProcess } from '../../../building-blocks/agent.port'
import type { Clock } from '../../../building-blocks/clock.port'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { ok } from '../../../building-blocks/result'
import { RELEASE_LIMITS } from '../idle-release'
import { Processes } from '../processes.store'
import { SessionStore } from '../session.store'
import { Transcript } from '../transcript.store'
import { retireIdleHandler, type RetireIdleDeps } from './retire-idle.handler'

// The locked tests of S9 (tests/architecture/m1-chat-s9-retire-idle.test.ts) run the handler with real
// agent processes. These tests use fake processes and cover the busy states and the failures.

const MINUTE = 60_000

class FakeProcess implements AgentProcess {
  readonly ready = Promise.resolve(ok({ agentSessionId: 'a', resumed: false, resumeError: null }))
  closes = 0
  failWith: Error | null = null

  prompt(): ReturnType<AgentProcess['prompt']> {
    return Promise.resolve(ok('end_turn' as const))
  }

  cancel(): Promise<void> {
    return Promise.resolve()
  }

  close(): Promise<void> {
    this.closes += 1
    return this.failWith ? Promise.reject(this.failWith) : Promise.resolve()
  }
}

function setup(sessions: { id: string; startedBy?: 'person' | 'automation' }[]) {
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  const { database } = opened.value
  database.prepare("INSERT INTO profiles (id, name, created_at) VALUES ('p1', 'Personal', '2026-01-01')").run()
  const store = new SessionStore(database)
  for (const { id, startedBy = 'person' } of sessions) {
    store.insert(
      { id, profileId: 'p1', title: 't', prompt: 'p', mode: 'ask', providerId: null, sourcePath: 'f', model: 'default', attachments: [], createdAt: '2026-01-01' },
      startedBy
    )
  }
  let time = new Date('2026-03-01T09:00:00.000Z').getTime()
  const clock: Clock = { now: () => new Date(time) }
  let count = 0
  const transcript = new Transcript(store, () => undefined, clock, { next: () => `e${++count}` })
  const processes = new Processes()
  const logged: string[] = []
  const processesById = new Map<string, FakeProcess>()
  const open = (id: string) => {
    const process = new FakeProcess()
    processesById.set(id, process)
    processes.set(id, process)
    processes.markIdle(id, clock.now())
    return process
  }
  const deps: RetireIdleDeps = { store, transcript, processes, clock, limits: RELEASE_LIMITS, log: (message, cause) => logged.push(`${message} ${String(cause)}`) }
  return { deps, store, transcript, processes, logged, open, advance: (ms: number) => void (time += ms), database }
}

describe('retireIdleHandler', () => {
  it('does nothing when no process is open', async () => {
    const { deps } = setup([{ id: 's1' }])
    await expect(retireIdleHandler(deps)).resolves.toBeUndefined()
  })

  it('closes an idle process of a person at 30 minutes and keeps it before', async () => {
    const { deps, open, advance, processes } = setup([{ id: 's1' }])
    const process = open('s1')
    advance(30 * MINUTE - 1)
    await retireIdleHandler(deps)
    expect(process.closes).toBe(0)
    advance(1)
    await retireIdleHandler(deps)
    expect(process.closes).toBe(1)
    expect(processes.get('s1')).toBeUndefined()
  })

  it('reads who started the session from the row: an automation closes at 2 minutes, a person does not', async () => {
    const { deps, open, advance } = setup([{ id: 'auto', startedBy: 'automation' }, { id: 'person' }])
    const auto = open('auto')
    const person = open('person')
    advance(2 * MINUTE)
    await retireIdleHandler(deps)
    expect([auto.closes, person.closes]).toEqual([1, 0])
  })

  it('keeps a session with a turn, a session that is not idle, and a session with an open request, however old', async () => {
    const { deps, open, advance, processes, transcript } = setup([{ id: 'turn' }, { id: 'working' }, { id: 'asked' }, { id: 'quiet' }])
    const turn = open('turn')
    const working = open('working')
    const asked = open('asked')
    const quiet = open('quiet')
    processes.beginTurn('turn')
    transcript.setStatus('working', 'working')
    advance(24 * 60 * MINUTE)
    await retireIdleHandler({ ...deps, openRequests: (id) => (id === 'asked' ? 1 : 0) })
    expect([turn.closes, working.closes, asked.closes, quiet.closes]).toEqual([0, 0, 0, 1])
  })

  it('closes the oldest idle process when more than 6 are idle, at once, with no time passed', async () => {
    const ids = ['s1', 's2', 's3', 's4', 's5', 's6', 's7']
    const { deps, open, advance, processes } = setup(ids.map((id) => ({ id })))
    const opened = ids.map((id) => {
      const process = open(id)
      advance(1000)
      return process
    })
    await retireIdleHandler(deps)
    expect(opened.map((process) => process.closes)).toEqual([1, 0, 0, 0, 0, 0, 0])
    expect(processes.openSessions().sort()).toEqual(ids.slice(1))
  })

  it('skips a session that the database does not know, and a process with no idle time', async () => {
    const { deps, processes, advance } = setup([{ id: 's1' }])
    const unknown = new FakeProcess()
    processes.set('unknown', unknown)
    processes.markIdle('unknown', deps.clock.now())
    const fresh = new FakeProcess()
    processes.set('s1', fresh)
    advance(24 * 60 * MINUTE)
    await retireIdleHandler(deps)
    expect([unknown.closes, fresh.closes]).toEqual([0, 0])
  })

  it('resolves after the closes that it started have ended, and logs a close that fails', async () => {
    const { deps, open, advance, logged } = setup([{ id: 's1' }, { id: 's2' }])
    const failing = open('s1')
    failing.failWith = new Error('close failed')
    const fine = open('s2')
    advance(30 * MINUTE)
    await retireIdleHandler(deps)
    expect(fine.closes).toBe(1)
    expect(logged.join('\n')).toContain('close failed')
  })

  it('logs a defect of one session and still releases the others', async () => {
    const { deps, open, advance, database, logged } = setup([{ id: 'bad' }, { id: 'good' }])
    open('bad')
    const good = open('good')
    database.prepare("UPDATE sessions SET started_by = 'robot' WHERE id = 'bad'").run()
    advance(30 * MINUTE)
    await retireIdleHandler(deps)
    expect(good.closes).toBe(1)
    expect(logged.join('\n')).toContain('bad')
  })

  it('closes each process once when it runs twice', async () => {
    const { deps, open, advance } = setup([{ id: 's1' }])
    const process = open('s1')
    advance(30 * MINUTE)
    await Promise.all([retireIdleHandler(deps), retireIdleHandler(deps)])
    expect(process.closes).toBe(1)
  })
})
