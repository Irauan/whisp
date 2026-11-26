import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ControlServer } from '../../../tests/simulated-agent/control'
import type { AgentRun } from '../../shared/agent'
import { AgentHost } from './host'
import type { AgentRegistry, ResolvedAgent } from './registry'
import { RunStore } from './run-store'

let control: ControlServer
let registry: AgentRegistry
let folder: string
let host: AgentHost
let onRun: (run: AgentRun) => void

beforeEach(async () => {
  control = await ControlServer.start()
  const fake: ResolvedAgent = {
    id: 'fake',
    name: 'Fake',
    ...control.agent,
    env: {},
    signInHint: 'Sign in first.',
    available: true,
    detail: ''
  }
  registry = { get: async (id: string) => (id === fake.id ? fake : undefined) } as AgentRegistry
  folder = await mkdtemp(join(tmpdir(), 'aether-host-'))
  onRun = () => undefined
  host = new AgentHost(registry, new RunStore(join(folder, 'runs')), (run) => onRun(run))
})

afterEach(async () => {
  await host.shutdown()
  await control.close()
  await rm(folder, { recursive: true, force: true })
})

const send = (itemId: string, text: string) => host.send({ itemId, agentId: 'fake', cwd: folder, text })

describe('AgentHost', () => {
  it('streams the reply of an ACP agent into the transcript', async () => {
    await control.scenario('text')
    await send('w1', 'hello')
    const run = await host.get('w1')
    expect(run.status).toBe('idle')
    expect(run.sessionId).toBe('s1')
    expect(run.entries).toMatchObject([{ kind: 'user', text: 'hello' }, { kind: 'agent', text: 'Hello' }])
  })

  it('continues the same session on the next message', async () => {
    await send('w1', 'hello')
    await send('w1', 'hello')
    expect((await host.get('w1')).sessionId).toBe('s1')
  })

  it('asks the user before a tool call and passes on the answer', async () => {
    await control.scenario('tool')
    onRun = (run) => {
      if (run.question) host.answer('w1', run.question.choices[0]!.id)
    }
    await send('w1', 'edit')
    const run = await host.get('w1')
    expect(run.question).toBeNull()
    expect(run.entries.slice(1)).toMatchObject([
      { kind: 'tool', title: 'Edit README.md', status: 'completed' },
      { kind: 'agent', text: 'Edited' }
    ])
  })

  it('refuses the tool call when the user stops the agent', async () => {
    await control.scenario('tool')
    onRun = (run) => {
      if (run.question) host.cancel('w1')
    }
    await send('w1', 'edit')
    expect((await host.get('w1')).entries.at(-1)).toMatchObject({ kind: 'agent', text: 'Skipped' })
  })

  it('stops a turn on request', async () => {
    // The agent waits at a gate that nobody opens. Only the cancel ends the turn.
    await control.scenario('text', { gate: 'never' })
    onRun = (run) => {
      if (run.status === 'working') host.cancel('w1')
    }
    await send('w1', 'wait')
    expect((await host.get('w1')).entries.at(-1)).toMatchObject({ kind: 'notice', text: 'Stopped.' })
  })

  it('explains how to sign in', async () => {
    await control.scenario('sign-in-error')
    await send('w1', 'auth')
    const run = await host.get('w1')
    expect(run.status).toBe('error')
    expect(run.entries.at(-1)).toMatchObject({ kind: 'notice', tone: 'error', text: 'Fake is not signed in. Sign in first.' })
  })

  it('keeps the conversation after a restart and resumes its session', async () => {
    await send('w1', 'hello')
    await host.shutdown()
    host = new AgentHost(registry, new RunStore(join(folder, 'runs')), () => undefined)
    expect((await host.get('w1')).entries).toHaveLength(2)
    await send('w1', 'hello')
    const run = await host.get('w1')
    expect(run.sessionId).toBe('s1')
    expect(run.entries).toHaveLength(4)
  })

  it('refuses a second message while the agent works', async () => {
    // The agent holds the turn at a gate. The first message is surely working when the
    // second goes out, and it ends only when the test opens the gate.
    await control.scenario('text', { gate: 'reply' })
    const first = send('w1', 'first')
    await control.waitForGate('reply')
    await expect(send('w1', 'second')).rejects.toThrow('still working')
    await control.open('reply')
    await first
    const run = await host.get('w1')
    expect(run.status).toBe('idle')
    expect(run.entries).toMatchObject([{ kind: 'user', text: 'first' }, { kind: 'agent', text: 'Hello' }])
  })

  it('shows "working" before the agent replies and the reply after it', async () => {
    await control.scenario('text', { gate: 'reply' })
    const sent = send('w1', 'hello')
    await control.waitForGate('reply')
    const before = await host.get('w1')
    expect(before.status).toBe('working')
    expect(before.entries).toMatchObject([{ kind: 'user', text: 'hello' }])
    await control.open('reply')
    await sent
    const after = await host.get('w1')
    expect(after.status).toBe('idle')
    expect(after.entries).toMatchObject([{ kind: 'user', text: 'hello' }, { kind: 'agent', text: 'Hello' }])
  })

  it('shows "starting" until a slow agent answers initialize', async () => {
    await control.scenario('slow-start')
    const sent = send('w1', 'hello')
    await control.waitForGate('initialize')
    expect((await host.get('w1')).status).toBe('starting')
    await control.open('initialize')
    await sent
    const run = await host.get('w1')
    expect(run.status).toBe('idle')
    expect(run.entries.at(-1)).toMatchObject({ kind: 'agent', text: 'Hello' })
  })

  it('reports an agent that ends, and starts a new process on the next message', async () => {
    await control.scenario('crash')
    await send('w1', 'hello')
    const crashed = await host.get('w1')
    expect(crashed.status).toBe('error')
    expect(crashed.entries.at(-1)).toMatchObject({ kind: 'notice', tone: 'error' })
    await control.waitForClose()

    await control.scenario('text')
    await send('w1', 'hello')
    const run = await host.get('w1')
    expect(run.status).toBe('idle')
    expect(run.entries.at(-1)).toMatchObject({ kind: 'agent', text: 'Hello' })
  })
})
