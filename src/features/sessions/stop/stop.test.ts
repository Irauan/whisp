import { describe, expect, it } from 'vitest'
import type { AgentProcess } from '../../../building-blocks/agent.port'
import { openDatabase } from '../../../building-blocks/database'
import { MIGRATIONS } from '../../../building-blocks/migrations'
import { err, ok } from '../../../building-blocks/result'
import type { PermissionRequest } from '../../../building-blocks/agent.port'
import { Processes } from '../processes.store'
import { SessionStore } from '../session.store'
import { Transcript } from '../transcript.store'
import { stopSession } from './stop.contract'
import { stopHandler } from './stop.handler'

function setup() {
  const opened = openDatabase(':memory:', MIGRATIONS)
  if (!opened.ok) throw new Error(opened.error.message)
  const { database } = opened.value
  database.prepare("INSERT INTO profiles (id, name, created_at) VALUES ('p1', 'Personal', '2026-01-01')").run()
  database
    .prepare(
      "INSERT INTO sessions (id, profile_id, title, prompt, mode, source_path, model, created_at) VALUES ('s1', 'p1', 't', 'p', 'ask', 'C:\\work', 'default', '2026-01-01')"
    )
    .run()
  const store = new SessionStore(database)
  const transcript = new Transcript(store, () => undefined, { now: () => new Date('2026-01-02T00:00:00.000Z') }, { next: (() => { let count = 0; return () => `e${++count}` })() })
  const processes = new Processes()
  const cancelled: string[] = []
  const process: AgentProcess = {
    ready: Promise.resolve(ok({ agentSessionId: 'a1', resumed: false, resumeError: null })),
    prompt: () => new Promise(() => undefined),
    cancel: () => {
      cancelled.push('cancel')
      return Promise.resolve()
    },
    answer: () => err('unknown-request', 'This request is closed.'),
    answerElicitation: () => err('unknown-request', 'This request is closed.'),
    close: () => Promise.resolve()
  }
  return { store, transcript, processes, process, cancelled, stop: (id: string) => stopHandler({ store, transcript, processes }, { id }) }
}

describe('sessions.stop', () => {
  it.each(['starting', 'working'] as const)('marks the turn and cancels the process in the state %s', (status) => {
    const { transcript, processes, process, cancelled, stop } = setup()
    transcript.setStatus('s1', status)
    const turn = processes.beginTurn('s1')
    processes.set('s1', process)
    const result = stop('s1')
    expect(result).toEqual({ ok: true, value: {} })
    expect(stopSession.output.safeParse(result).success).toBe(true)
    expect(turn.stopped).toBe(true)
    expect(cancelled).toEqual(['cancel'])
  })

  it('marks the turn also when the process does not exist yet', () => {
    const { transcript, processes, stop } = setup()
    transcript.setStatus('s1', 'starting')
    const turn = processes.beginTurn('s1')
    expect(stop('s1').ok).toBe(true)
    expect(turn.stopped).toBe(true)
  })

  it('changes nothing in the state Idle', () => {
    const { processes, process, cancelled, stop } = setup()
    processes.set('s1', process)
    expect(stop('s1')).toEqual({ ok: true, value: {} })
    expect(cancelled).toEqual([])
  })

  it('refuses a session that does not exist', () => {
    const { stop } = setup()
    const result = stop('missing')
    expect(result).toMatchObject({ ok: false, error: { code: 'unknown-session' } })
    expect(stopSession.output.safeParse(result).success).toBe(true)
  })
})

describe('sessions.stop with open cards', () => {
  const request: PermissionRequest = { id: 'r1', toolId: 't1', title: 'npm test', toolKind: 'execute', locations: [], options: [] }

  it('closes each open card with the reason stopped before it cancels the process', () => {
    const { store, transcript, processes, process, cancelled, stop } = setup()
    transcript.setStatus('s1', 'working')
    processes.beginTurn('s1')
    processes.set('s1', process)
    transcript.openPermission('s1', request)
    transcript.openPermission('s1', { ...request, id: 'r2', toolId: 't2' })
    expect(stop('s1').ok).toBe(true)
    expect(transcript.openCardCount('s1')).toBe(0)
    expect(store.entriesOf('s1').map((view) => (view.entry.kind === 'answers' ? view.entry.outcome : null))).toEqual(['stopped', 'stopped'])
    expect(cancelled).toEqual(['cancel'])
  })

  it('stops a card outside a turn: the session is idle, but the card closes and the process cancels', () => {
    const { store, transcript, processes, process, cancelled, stop } = setup()
    processes.set('s1', process)
    transcript.openPermission('s1', request)
    expect(transcript.statusOf('s1')).toBe('idle')
    expect(stop('s1').ok).toBe(true)
    expect(transcript.openCardCount('s1')).toBe(0)
    expect(store.entriesOf('s1')[0]?.entry).toMatchObject({ kind: 'answers', outcome: 'stopped', rows: [{ answer: null }] })
    expect(cancelled).toEqual(['cancel'])
  })
})
