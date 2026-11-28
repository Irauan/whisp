import { describe, expect, it } from 'vitest'
import type { AgentProcess } from '../../building-blocks/agent.port'
import { err, ok } from '../../building-blocks/result'
import { Processes } from './processes.store'

/** One deferred value, so that a test decides when a process finishes its close. */
function deferred() {
  let resolve: () => void = () => undefined
  let reject: (cause: unknown) => void = () => undefined
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

class FakeProcess implements AgentProcess {
  readonly ready = Promise.resolve(ok({ agentSessionId: 'a', resumed: false, resumeError: null }))
  closes = 0
  readonly end = deferred()

  prompt(): ReturnType<AgentProcess['prompt']> {
    return Promise.resolve(ok('end_turn' as const))
  }

  cancel(): Promise<void> {
    return Promise.resolve()
  }

  answer(): ReturnType<AgentProcess['answer']> {
    return err('unknown-request', 'This request is closed.')
  }

  answerElicitation(): ReturnType<AgentProcess['answerElicitation']> {
    return err('unknown-request', 'This request is closed.')
  }

  close(): Promise<void> {
    this.closes += 1
    return this.end.promise
  }
}

const AT = new Date('2026-03-01T09:00:00.000Z')

describe('Processes: the idle time', () => {
  it('has no idle time for a session with no process, or with a process that never ended a turn', () => {
    const processes = new Processes()
    processes.markIdle('s1', AT)
    expect(processes.idleSince('s1')).toBeNull()
    processes.set('s1', new FakeProcess())
    expect(processes.idleSince('s1')).toBeNull()
  })

  it('keeps the time that markIdle sets, and a new mark replaces it', () => {
    const processes = new Processes()
    processes.set('s1', new FakeProcess())
    processes.markIdle('s1', AT)
    expect(processes.idleSince('s1')).toEqual(AT)
    const later = new Date(AT.getTime() + 1000)
    processes.markIdle('s1', later)
    expect(processes.idleSince('s1')).toEqual(later)
  })

  it('forgets the idle time when the process ends, is dropped or is replaced', () => {
    const processes = new Processes()
    const first = new FakeProcess()
    processes.set('s1', first)
    processes.markIdle('s1', AT)
    processes.drop('s1', new FakeProcess()) // an older process: nothing changes
    expect(processes.idleSince('s1')).toEqual(AT)
    processes.drop('s1', first)
    expect(processes.idleSince('s1')).toBeNull()
    processes.set('s1', first)
    processes.markIdle('s1', AT)
    processes.set('s1', new FakeProcess())
    expect(processes.idleSince('s1')).toBeNull()
  })

  it('lists the sessions with an open process', () => {
    const processes = new Processes()
    processes.set('s1', new FakeProcess())
    processes.set('s2', new FakeProcess())
    expect(processes.openSessions().sort()).toEqual(['s1', 's2'])
  })
})

describe('Processes: retire', () => {
  it('takes the process out and starts its close in one synchronous step', () => {
    const processes = new Processes()
    const process = new FakeProcess()
    processes.set('s1', process)
    processes.markIdle('s1', AT)
    const closed = processes.retire('s1')
    // No `await` happened: the process is gone and its close has started.
    expect(closed).not.toBeNull()
    expect(process.closes).toBe(1)
    expect(processes.get('s1')).toBeUndefined()
    expect(processes.idleSince('s1')).toBeNull()
  })

  it('does nothing for a session with a turn, and for a session with no process', () => {
    const processes = new Processes()
    const process = new FakeProcess()
    processes.set('s1', process)
    processes.beginTurn('s1')
    expect(processes.retire('s1')).toBeNull()
    expect(process.closes).toBe(0)
    expect(processes.get('s1')).toBe(process)
    expect(processes.retire('nobody')).toBeNull()
  })

  it('lets `closed` wait for the close, and resolves at once when nothing closes', async () => {
    const processes = new Processes()
    const process = new FakeProcess()
    processes.set('s1', process)
    await processes.closed('s1')
    const closed = processes.retire('s1')
    let waited = false
    const waiting = processes.closed('s1').then(() => {
      waited = true
    })
    await Promise.resolve()
    expect(waited).toBe(false)
    process.end.resolve()
    await closed
    await waiting
    expect(waited).toBe(true)
    // The close ended: a later start does not wait.
    await processes.closed('s1')
  })

  it('never rejects in `closed`, also when the close fails', async () => {
    const processes = new Processes()
    const process = new FakeProcess()
    processes.set('s1', process)
    const closed = processes.retire('s1')
    const failure = closed?.catch((cause: unknown) => cause)
    process.end.reject(new Error('close failed'))
    await expect(processes.closed('s1')).resolves.toBeUndefined()
    expect(await failure).toEqual(new Error('close failed'))
  })

  it('makes `release` and `releaseAll` wait for a close in flight', async () => {
    const processes = new Processes()
    const process = new FakeProcess()
    processes.set('s1', process)
    void processes.retire('s1')
    let released = false
    const releasing = processes.release('s1').then(() => {
      released = true
    })
    await Promise.resolve()
    expect(released).toBe(false)
    process.end.resolve()
    await releasing
    expect(released).toBe(true)

    const second = new FakeProcess()
    processes.set('s2', second)
    void processes.retire('s2')
    let quit = false
    const quitting = processes.releaseAll().then(() => {
      quit = true
    })
    await Promise.resolve()
    expect(quit).toBe(false)
    second.end.resolve()
    await quitting
    expect(quit).toBe(true)
  })
})

describe('Processes: the hook of a process that is gone', () => {
  it('tells the caller when a process leaves by a crash, a release or a close, and not when a newer process stays', async () => {
    const gone: string[] = []
    const processes = new Processes((id) => gone.push(id))
    const one = new FakeProcess()
    const two = new FakeProcess()
    processes.set('a', one)
    processes.drop('a', two)
    expect(gone).toEqual([])
    processes.drop('a', one)
    expect(gone).toEqual(['a'])

    processes.set('b', new FakeProcess())
    processes.retire('b')?.catch(() => undefined)
    expect(gone).toEqual(['a', 'b'])

    const last = new FakeProcess()
    processes.set('c', last)
    const released = processes.release('c')
    last.end.resolve()
    await released
    expect(gone).toEqual(['a', 'b', 'c'])
    await processes.release('nothing')
    expect(gone).toEqual(['a', 'b', 'c'])
  })
})
