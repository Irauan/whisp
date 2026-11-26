import { spawn, type ChildProcess } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type ClientConnection,
  type InitializeResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse
} from '@agentclientprotocol/sdk'
import {
  applyUpdate,
  settleTools,
  type AgentRun,
  type ChatEntry,
  type PermissionChoice,
  type SessionUpdateLike
} from '../../shared/agent'
import type { AgentRegistry, ResolvedAgent } from './registry'

/**
 * Keeps the conversation of each work item. The old store wrote one file in `runs/` for each item.
 * Aether no longer writes `runs/` (decision 0005). A later story replaces this host with the session
 * slices, which save each conversation entry in the database.
 */
export interface RunStore {
  load(itemId: string): Promise<AgentRun>
  save(run: AgentRun): Promise<void>
  remove(itemId: string): Promise<void>
  settled(): Promise<void>
}

/** ACP's error code for "nobody is signed in". */
const AUTH_REQUIRED = -32000

interface PendingQuestion {
  requestId: string
  resolve(response: RequestPermissionResponse): void
}

/** One running agent program. It can hold the sessions of many work items. */
class AgentProcess {
  readonly sessions = new Set<string>()
  /** The work item of each session, to route the agent's messages. */
  readonly owners = new Map<string, string>()
  private child: ChildProcess | null = null
  private connection: ClientConnection | null = null
  private capabilities: InitializeResponse | null = null
  private stderr = ''

  constructor(
    readonly agent: ResolvedAgent,
    private readonly host: AgentHost
  ) {}

  get alive(): boolean {
    return this.connection !== null && !this.connection.signal.aborted
  }

  get canResume(): boolean {
    return Boolean(this.capabilities?.agentCapabilities?.sessionCapabilities?.resume)
  }

  get canLoad(): boolean {
    return Boolean(this.capabilities?.agentCapabilities?.loadSession)
  }

  get ctx() {
    if (!this.connection) throw new Error(`${this.agent.name} is not running.`)
    return this.connection.agent
  }

  async start(): Promise<void> {
    const child = spawn(this.agent.command, this.agent.args, {
      env: { ...process.env, ...this.agent.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.child = child
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (text: string) => {
      // Keep the end of the agent's log to explain a failed start.
      this.stderr = (this.stderr + text).slice(-4000)
    })
    const spawned = new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    child.once('exit', (code) => this.host.processExited(this, code))
    await spawned

    const app = client({ name: 'Aether' })
      .onNotification(methods.client.session.update, ({ params }) => {
        const itemId = this.owners.get(params.sessionId)
        if (itemId) this.host.sessionUpdate(itemId, params.update as SessionUpdateLike)
      })
      .onRequest(methods.client.session.requestPermission, ({ params, signal }) => {
        const itemId = this.owners.get(params.sessionId)
        if (!itemId) return { outcome: { outcome: 'cancelled' } }
        return this.host.askPermission(itemId, params, signal)
      })

    this.connection = app.connect(
      ndJsonStream(
        Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>
      )
    )
    try {
      this.capabilities = await this.ctx.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'aether', title: 'Aether', version: '0.1.0' },
        // Agents use their own tools for files and commands. Aether only shows
        // what they do and asks the user before they do it.
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }
      })
    } catch (error) {
      this.stop()
      throw new Error(`${this.agent.name} did not start. ${describe(error)}${this.logTail()}`)
    }
  }

  logTail(): string {
    const tail = this.stderr.trim().split('\n').slice(-3).join('\n')
    return tail ? `\n${tail}` : ''
  }

  stop(): void {
    this.connection?.close()
    this.connection = null
    if (this.child && this.child.exitCode === null) this.child.kill()
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Runs the agent conversations of the work items. The renderer sees each
 * conversation as an `AgentRun`, sent again after every change.
 */
export class AgentHost {
  private readonly runs = new Map<string, AgentRun>()
  private readonly processes = new Map<string, AgentProcess>()
  private readonly questions = new Map<string, PendingQuestion>()
  private readonly cancels = new Map<string, () => void>()
  private readonly flushes = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly registry: AgentRegistry,
    private readonly store: RunStore,
    private readonly publish: (run: AgentRun) => void
  ) {}

  async get(itemId: string): Promise<AgentRun> {
    const known = this.runs.get(itemId)
    if (known) return known
    const loaded = await this.store.load(itemId)
    // Another call may have loaded it meanwhile.
    const raced = this.runs.get(itemId)
    if (raced) return raced
    this.runs.set(itemId, loaded)
    return loaded
  }

  async send(request: { itemId: string; agentId: string; cwd: string; text: string }): Promise<void> {
    const { itemId, cwd } = request
    const text = request.text.trim()
    if (!text) return
    const run = await this.get(itemId)
    if (run.status === 'starting' || run.status === 'working') {
      throw new Error('The agent is still working on the last message.')
    }
    const agent = await this.registry.get(request.agentId)
    if (!agent?.available) throw new Error(agent ? agent.detail : 'Aether does not know that agent.')

    const entries: ChatEntry[] = [...run.entries]
    let sessionId = run.sessionId
    if (run.agentId && run.agentId !== agent.id) {
      entries.push({ kind: 'notice', tone: 'info', text: `Switched to ${agent.name}. It starts a new conversation.` })
      sessionId = null
    }
    entries.push({ kind: 'user', text, at: new Date().toISOString() })
    this.update(itemId, { agentId: agent.id, sessionId, status: 'starting', entries }, true)

    let stopped = false
    this.cancels.set(itemId, () => {
      stopped = true
    })
    try {
      const process = await this.process(agent)
      sessionId = await this.session(process, itemId, sessionId, cwd)
      if (stopped) throw new Error('Stopped before the agent started.')
      const ctx = process.ctx
      const active = sessionId
      // Send the prompt before the run shows as working, so that a Stop always
      // reaches the agent after the prompt it cancels.
      const turn = ctx.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text }] })
      this.cancels.set(itemId, () => {
        void ctx.notify(methods.agent.session.cancel, { sessionId: active }).catch(() => undefined)
      })
      this.update(itemId, { sessionId, status: 'working' }, true)
      const response = await turn
      const done = settleTools(this.runs.get(itemId)?.entries ?? [])
      const note = stopNote(response.stopReason)
      this.update(itemId, { status: 'idle', question: null, entries: note ? [...done, note] : done }, true)
    } catch (error) {
      const current = this.runs.get(itemId)
      if (!current) return // The work item was deleted.
      const message =
        error instanceof RequestError && error.code === AUTH_REQUIRED
          ? `${agent.name} is not signed in. ${agent.signInHint ?? error.message}`
          : describe(error)
      this.update(
        itemId,
        {
          status: 'error',
          question: null,
          entries: [...settleTools(current.entries), { kind: 'notice', tone: 'error', text: message }]
        },
        true
      )
    } finally {
      this.cancels.delete(itemId)
    }
  }

  cancel(itemId: string): void {
    this.answer(itemId, null)
    this.cancels.get(itemId)?.()
  }

  /** Answers the open permission question of a work item. `null` refuses it. */
  answer(itemId: string, choiceId: string | null): void {
    const question = this.questions.get(itemId)
    if (!question) return
    this.questions.delete(itemId)
    question.resolve(
      choiceId === null
        ? { outcome: { outcome: 'cancelled' } }
        : { outcome: { outcome: 'selected', optionId: choiceId } }
    )
    this.update(itemId, { question: null })
  }

  /** Stops the conversation of a deleted work item and removes its file. */
  async forget(itemId: string): Promise<void> {
    this.cancel(itemId)
    for (const process of this.processes.values()) {
      for (const [sessionId, owner] of process.owners) {
        if (owner === itemId) process.owners.delete(sessionId)
      }
    }
    clearTimeout(this.flushes.get(itemId))
    this.flushes.delete(itemId)
    this.runs.delete(itemId)
    await this.store.remove(itemId)
  }

  async shutdown(): Promise<void> {
    for (const itemId of this.questions.keys()) this.answer(itemId, null)
    for (const process of this.processes.values()) process.stop()
    this.processes.clear()
    for (const [itemId, timer] of this.flushes) {
      clearTimeout(timer)
      const run = this.runs.get(itemId)
      if (run) void this.store.save(run)
    }
    await this.store.settled()
  }

  // Called by AgentProcess.

  sessionUpdate(itemId: string, update: SessionUpdateLike): void {
    const run = this.runs.get(itemId)
    if (!run) return
    const entries = applyUpdate(run.entries, update)
    if (entries !== run.entries) this.update(itemId, { entries })
  }

  askPermission(
    itemId: string,
    params: RequestPermissionRequest,
    signal: AbortSignal
  ): Promise<RequestPermissionResponse> {
    // Only one question at a time: a newer one replaces an older one.
    this.answer(itemId, null)
    const requestId = crypto.randomUUID()
    const choices: PermissionChoice[] = params.options.map((option) => ({
      id: option.optionId,
      name: option.name,
      kind: option.kind
    }))
    const run = this.runs.get(itemId)
    const known = run?.entries.find((entry) => entry.kind === 'tool' && entry.id === params.toolCall.toolCallId)
    const title = params.toolCall.title || (known?.kind === 'tool' ? known.title : 'Use a tool')
    return new Promise((resolve) => {
      this.questions.set(itemId, { requestId, resolve })
      signal.addEventListener('abort', () => {
        if (this.questions.get(itemId)?.requestId === requestId) this.answer(itemId, null)
      })
      this.update(itemId, { question: { requestId, title, choices } })
    })
  }

  processExited(process: AgentProcess, code: number | null): void {
    if (this.processes.get(process.agent.id) === process) this.processes.delete(process.agent.id)
    for (const itemId of new Set(process.owners.values())) {
      const run = this.runs.get(itemId)
      if (run?.status !== 'working' && run?.status !== 'starting') continue
      // The pending prompt request fails too; this note says why.
      this.update(itemId, {
        entries: [
          ...run.entries,
          { kind: 'notice', tone: 'error', text: `${process.agent.name} stopped (exit code ${code ?? 'none'}).${process.logTail()}` }
        ]
      })
    }
  }

  private async process(agent: ResolvedAgent): Promise<AgentProcess> {
    const known = this.processes.get(agent.id)
    if (known?.alive) return known
    known?.stop()
    const process = new AgentProcess(agent, this)
    this.processes.set(agent.id, process)
    try {
      await process.start()
    } catch (error) {
      if (this.processes.get(agent.id) === process) this.processes.delete(agent.id)
      throw error
    }
    return process
  }

  /** Continues the item's conversation when the agent can, or starts one. */
  private async session(process: AgentProcess, itemId: string, sessionId: string | null, cwd: string) {
    if (sessionId && process.sessions.has(sessionId)) return sessionId
    const ctx = process.ctx
    if (sessionId && (process.canResume || process.canLoad)) {
      try {
        if (process.canResume) {
          await ctx.request(methods.agent.session.resume, { sessionId, cwd, mcpServers: [] })
        } else {
          // Loading replays the conversation, which Aether already shows, so
          // the session gets its owner only after the replay.
          await ctx.request(methods.agent.session.load, { sessionId, cwd, mcpServers: [] })
        }
        process.sessions.add(sessionId)
        process.owners.set(sessionId, itemId)
        return sessionId
      } catch (error) {
        const run = this.runs.get(itemId)
        if (run) {
          this.update(itemId, {
            entries: [
              ...run.entries,
              { kind: 'notice', tone: 'info', text: `Could not continue the last conversation, so a new one starts. ${describe(error)}` }
            ]
          })
        }
      }
    }
    const created = await ctx.request(methods.agent.session.new, { cwd, mcpServers: [] })
    process.sessions.add(created.sessionId)
    process.owners.set(created.sessionId, itemId)
    return created.sessionId
  }

  private update(itemId: string, change: Partial<AgentRun>, saveNow = false): void {
    const run = this.runs.get(itemId)
    if (!run) return
    const next = { ...run, ...change }
    this.runs.set(itemId, next)
    this.publish(next)
    // Streamed text changes the run many times a second, so save a second after the last change.
    clearTimeout(this.flushes.get(itemId))
    this.flushes.delete(itemId)
    if (saveNow) {
      void this.store.save(next)
      return
    }
    this.flushes.set(
      itemId,
      setTimeout(() => {
        this.flushes.delete(itemId)
        const latest = this.runs.get(itemId)
        if (latest) void this.store.save(latest)
      }, 1000)
    )
  }
}

function stopNote(reason: string): ChatEntry | null {
  switch (reason) {
    case 'cancelled':
      return { kind: 'notice', tone: 'info', text: 'Stopped.' }
    case 'max_tokens':
      return { kind: 'notice', tone: 'error', text: 'The agent reached its output limit.' }
    case 'max_turn_requests':
      return { kind: 'notice', tone: 'error', text: 'The agent reached its limit of steps for one message.' }
    case 'refusal':
      return { kind: 'notice', tone: 'error', text: 'The agent declined this request.' }
    default:
      return null
  }
}
