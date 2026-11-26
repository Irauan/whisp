import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentRun } from '../../shared/agent'
import { AgentHost } from './host'
import type { AgentRegistry, ResolvedAgent } from './registry'
import { RunStore } from './run-store'

const fake: ResolvedAgent = {
  id: 'fake',
  name: 'Fake',
  command: process.execPath,
  args: [join(__dirname, 'fixtures/fake-agent.mjs')],
  env: {},
  signInHint: 'Sign in first.',
  available: true,
  detail: ''
}

const registry = { get: async (id: string) => (id === fake.id ? fake : undefined) } as AgentRegistry

let folder: string
let host: AgentHost
let onRun: (run: AgentRun) => void

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'aether-host-'))
  onRun = () => undefined
  host = new AgentHost(registry, new RunStore(join(folder, 'runs')), (run) => onRun(run))
})

afterEach(async () => {
  await host.shutdown()
  await rm(folder, { recursive: true, force: true })
})

const send = (itemId: string, text: string) => host.send({ itemId, agentId: 'fake', cwd: folder, text })

describe('AgentHost', () => {
  it('streams the reply of an ACP agent into the transcript', async () => {
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
    onRun = (run) => {
      if (run.question) host.cancel('w1')
    }
    await send('w1', 'edit')
    expect((await host.get('w1')).entries.at(-1)).toMatchObject({ kind: 'agent', text: 'Skipped' })
  })

  it('stops a turn on request', async () => {
    onRun = (run) => {
      if (run.status === 'working') host.cancel('w1')
    }
    await send('w1', 'wait')
    expect((await host.get('w1')).entries.at(-1)).toMatchObject({ kind: 'notice', text: 'Stopped.' })
  })

  it('explains how to sign in', async () => {
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
    // The second message goes out while the run is working. The run is cancelled only after
    // that message is refused, so the test does not race with the cancel.
    let second: Promise<unknown> | undefined
    onRun = (run) => {
      if (run.status === 'working' && !second) {
        second = send('w1', 'hello')
        void second.catch(() => host.cancel('w1'))
      }
    }
    await send('w1', 'wait')
    await expect(second).rejects.toThrow('still working')
  })
})
