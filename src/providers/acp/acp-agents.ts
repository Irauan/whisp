import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type ClientConnection,
  type ContentBlock,
  type InitializeResponse,
  type SessionUpdate
} from '@agentclientprotocol/sdk'
import { allowedEnvironment } from '../../building-blocks/agent-environment'
import type {
  AgentListener,
  AgentPort,
  AgentProcess,
  AgentStartInput,
  AgentUpdate,
  PromptErrorCode,
  PromptLink,
  StartErrorCode,
  Started,
  StopReason,
  ToolStatus
} from '../../building-blocks/agent.port'
import type { Mode } from '../../building-blocks/mode'
import { err, ok, type Result } from '../../building-blocks/result'
import type { AcpRecipe } from './recipe'

/** The ACP error code for "nobody is signed in". */
const AUTH_REQUIRED = -32000

/** How much of the log of the agent Aether keeps, in characters. */
const LOG_LIMIT = 4000

/** How many lines of the log a message shows. */
const LOG_LINES = 5

/** The time that a process gets to end after its stdin closes, before Aether kills its process tree. */
const CLOSE_LIMIT_MS = 3000

/** The time that Aether waits for the exit code of a process whose connection closed. */
const EXIT_WAIT_MS = 2000

export interface AcpOptions {
  recipe: AcpRecipe
  /** The environment of Aether. Only the allow list of it reaches the agent. It is `process.env` by default. */
  environment?: () => Readonly<Record<string, string | undefined>>
  /** The time that a process gets to end after its stdin closes. */
  closeLimitMs?: number
}

/** The port to agents that speak ACP. It starts one process for each call. */
export class AcpAgents implements AgentPort {
  constructor(private readonly options: AcpOptions) {}

  start(input: AgentStartInput, listener: AgentListener): AgentProcess {
    return new AcpProcess(input, listener, this.options)
  }
}

const TOOL_STATUSES: readonly string[] = ['pending', 'in_progress', 'completed', 'failed']
const STEP_STATUSES: readonly string[] = ['pending', 'in_progress', 'completed']

const toolStatus = (value: unknown): ToolStatus | null => (TOOL_STATUSES.includes(value as string) ? (value as ToolStatus) : null)

function textOf(content: unknown): string | null {
  if (typeof content !== 'object' || content === null) return null
  const block = content as { type?: unknown; text?: unknown }
  return block.type === 'text' && typeof block.text === 'string' && block.text !== '' ? block.text : null
}

/** Turns a `session/update` of ACP into an update of the port. An update that Aether does not show gives null. */
export function translateUpdate(update: SessionUpdate, modeOf: (id: string) => Mode | null = () => null): AgentUpdate | null {
  switch (update.sessionUpdate) {
    case 'current_mode_update': {
      const mode = modeOf(update.currentModeId)
      return mode === null ? null : { type: 'mode', mode }
    }
    case 'agent_message_chunk': {
      const text = textOf(update.content)
      return text === null ? null : { type: 'text', text }
    }
    case 'agent_thought_chunk': {
      const text = textOf(update.content)
      return text === null ? null : { type: 'thought', text }
    }
    case 'tool_call':
      return {
        type: 'tool',
        id: update.toolCallId,
        title: update.title || 'Tool call',
        toolKind: update.kind || 'other',
        status: toolStatus(update.status) ?? 'pending'
      }
    case 'tool_call_update':
      return {
        type: 'tool-update',
        id: update.toolCallId,
        title: update.title || null,
        toolKind: update.kind || null,
        status: toolStatus(update.status)
      }
    case 'plan':
      return {
        type: 'plan',
        steps: update.entries.map((step) => ({
          text: step.content,
          status: STEP_STATUSES.includes(step.status) ? (step.status as 'pending' | 'in_progress' | 'completed') : 'pending'
        }))
      }
    default:
      return null
  }
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Resolves true when the promise settles within the limit, and false after it. The promise never rejects here. */
async function within(promise: Promise<unknown>, limitMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), limitMs)
  })
  try {
    return await Promise.race([promise.then(() => true, () => true), late])
  } finally {
    clearTimeout(timer)
  }
}

/** Kills the process and all its children. On Windows `child.kill` ends only the parent. */
function killTree(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    const { pid } = child
    if (process.platform !== 'win32' || pid === undefined) {
      child.kill()
      resolve()
      return
    }
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve())
  })
}

class AcpProcess implements AgentProcess {
  readonly ready: Promise<Result<Started, StartErrorCode>>
  private child: ChildProcess | null = null
  private connection: ClientConnection | null = null
  private capabilities: InitializeResponse | null = null
  private sessionId: string | null = null
  private isReady = false
  private aborted = false
  private turnActive = false
  private stderr = ''
  private closing: Promise<void> | null = null
  private readonly ended: Promise<void>
  private markEnded: () => void = () => undefined

  constructor(
    private readonly input: AgentStartInput,
    private readonly listener: AgentListener,
    private readonly options: AcpOptions
  ) {
    this.ended = new Promise((resolve) => {
      this.markEnded = resolve
    })
    this.ready = this.boot().then((result) => {
      if (!result.ok) void this.close()
      return result
    })
  }

  private get name(): string {
    return this.options.recipe.name
  }

  private get context() {
    if (!this.connection) throw new Error(`${this.name} is not running.`)
    return this.connection.agent
  }

  /** The last lines of the log, with the values that Aether gave the agent removed. */
  private logTail(): string {
    const tail = this.redact(this.stderr.trim().split('\n').slice(-LOG_LINES).join('\n'))
    return tail ? `\n${tail}` : ''
  }

  /** The text with the values that Aether gave the agent removed, for example `GH_TOKEN`. */
  private redact(text: string): string {
    let result = text
    for (const value of Object.values(this.input.environment)) {
      if (value.length >= 4) result = result.replaceAll(value, '[removed]')
    }
    return result
  }

  /** An error whose message passes `redact`. Each message that Aether saves or shows goes through it. */
  private refuse<Code extends string>(code: Code, message: string): Result<never, Code> {
    return err(code, this.redact(message))
  }

  private cancelled(): Result<never, StartErrorCode> {
    return err('cancelled', 'The start was cancelled.')
  }

  private async boot(): Promise<Result<Started, StartErrorCode>> {
    try {
      const { recipe } = this.options
      const launch = await recipe.launch(this.input.settings)
      if (!launch.ok) return this.refuse('unavailable', launch.error.message)
      if (this.aborted) return this.cancelled()

      const environment = {
        ...allowedEnvironment((this.options.environment ?? (() => process.env))()),
        ...launch.value.env,
        ...this.input.environment
      }
      const spawned = await this.spawn(launch.value.command, launch.value.args, environment)
      if (!spawned.ok) return spawned
      if (this.aborted) return this.cancelled()

      const response = await this.context.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'aether', title: 'Aether', version: '0.1.0' },
        // Agents use their own tools for files and commands. Aether shows what they do.
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }
      })
      this.capabilities = response

      const started = await this.openSession()
      if (this.aborted) return this.cancelled()
      const applied = await this.applySettings()
      if (!applied.ok) return applied
      if (this.aborted) return this.cancelled()
      this.isReady = true
      return ok(started)
    } catch (error) {
      if (this.aborted) return this.cancelled()
      return this.failure(error)
    }
  }

  /** The start error for a failed request. A missing sign-in gets its own code, with the sign-in steps. */
  private failure(error: unknown): Result<never, StartErrorCode> {
    if (error instanceof RequestError && error.code === AUTH_REQUIRED) {
      return err('not-signed-in', this.options.recipe.notSignedIn(this.input.settings))
    }
    return this.refuse('failed', `${this.name} did not start. ${describe(error)}${this.logTail()}`)
  }

  private spawn(command: string, args: string[], env: Record<string, string>): Promise<Result<true, StartErrorCode>> {
    return new Promise((resolve) => {
      const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      this.child = child
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (text: string) => {
        // Keep the end of the log, to explain a failed start or a crash.
        this.stderr = (this.stderr + text).slice(-LOG_LIMIT)
      })
      // A write to a closed pipe is not a defect of Aether. The exit reports it.
      child.stdin.on('error', () => undefined)
      child.once('error', (error) => resolve(this.refuse('unavailable', `${this.name} did not start. ${error.message}`)))
      child.once('close', (code) => {
        this.markEnded()
        this.listener.exited({ code, logTail: this.logTail().trim() })
      })
      child.once('spawn', () => {
        this.connection = client({ name: 'Aether' })
          .onNotification(methods.client.session.update, ({ params }) => {
            if (params.sessionId !== this.sessionId) return
            const update = translateUpdate(params.update, (id) => this.options.recipe.modeOf(id))
            if (update) this.listener.update(update)
          })
          // Story S5 builds the permission queue. Until then no request is allowed.
          .onRequest(methods.client.session.requestPermission, () => ({ outcome: { outcome: 'cancelled' } }))
          .connect(
            ndJsonStream(
              Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
              Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>
            )
          )
        resolve(ok(true))
      })
    })
  }

  /** Resumes the agent session of the input, or starts a new one. */
  private async openSession(): Promise<Started> {
    const { mainDirectory, additionalDirectories, resume } = this.input
    const folders = {
      cwd: mainDirectory,
      ...(additionalDirectories.length > 0 ? { additionalDirectories: [...additionalDirectories] } : {})
    }
    let resumeError: string | null = null
    if (resume !== null) {
      const abilities = this.capabilities?.agentCapabilities
      try {
        if (abilities?.sessionCapabilities?.resume) {
          await this.context.request(methods.agent.session.resume, { sessionId: resume, mcpServers: [], ...folders })
        } else if (abilities?.loadSession) {
          // Loading replays the conversation, which Aether has saved. The updates of the replay
          // find no session ID yet, so Aether drops them.
          await this.context.request(methods.agent.session.load, { sessionId: resume, mcpServers: [], ...folders })
        } else {
          throw new Error(`${this.name} cannot continue an earlier session.`)
        }
        this.sessionId = resume
        return { agentSessionId: resume, resumed: true, resumeError: null }
      } catch (error) {
        // A missing sign-in is not a reason to start a new session.
        if (error instanceof RequestError && error.code === AUTH_REQUIRED) throw error
        if (this.aborted) throw error
        resumeError = this.redact(describe(error))
      }
    }
    const created = await this.context.request(methods.agent.session.new, { mcpServers: [], ...folders })
    this.sessionId = created.sessionId
    return { agentSessionId: created.sessionId, resumed: false, resumeError }
  }

  /** Sets the mode, then the model, before the first prompt. A refusal ends the start (decision 0007). */
  private async applySettings(): Promise<Result<true, StartErrorCode>> {
    const sessionId = this.sessionId
    if (sessionId === null) throw new Error('The agent session does not exist.')
    const modeId = this.options.recipe.modeId(this.input.mode)
    try {
      await this.context.request(methods.agent.session.setMode, { sessionId, modeId })
    } catch (error) {
      if (this.aborted || !(error instanceof RequestError)) throw error
      if (error.code === AUTH_REQUIRED) throw error
      return this.refuse('settings-refused', `${this.name} did not accept the mode "${modeId}". ${error.message}`)
    }
    if (this.input.model !== 'default') {
      try {
        await this.context.request(methods.agent.session.setConfigOption, {
          sessionId,
          configId: 'model',
          value: this.input.model
        })
      } catch (error) {
        if (this.aborted || !(error instanceof RequestError)) throw error
        if (error.code === AUTH_REQUIRED) throw error
        return this.refuse('settings-refused', `${this.name} did not accept the model "${this.input.model}". ${error.message}`)
      }
    }
    return ok(true)
  }

  async prompt(text: string, links: readonly PromptLink[] = []): Promise<Result<StopReason, PromptErrorCode>> {
    const ready = await this.ready
    if (!ready.ok) return err(ready.error.code === 'not-signed-in' ? 'not-signed-in' : 'failed', ready.error.message)
    const sessionId = this.sessionId
    if (sessionId === null) return err('failed', `${this.name} has no session.`)
    this.turnActive = true
    try {
      const prompt: ContentBlock[] = [
        { type: 'text', text },
        ...links.map(({ path, name }): ContentBlock => ({ type: 'resource_link', uri: pathToFileURL(path).href, name }))
      ]
      const response = await this.context.request(methods.agent.session.prompt, { sessionId, prompt })
      return ok(response.stopReason)
    } catch (error) {
      if (error instanceof RequestError) {
        if (error.code === AUTH_REQUIRED) return err('not-signed-in', this.options.recipe.notSignedIn(this.input.settings))
        return this.refuse('failed', `${this.name} could not answer. ${error.message}`)
      }
      // The connection closed: the process ended. Wait for its exit code and its last log lines.
      await within(this.ended, EXIT_WAIT_MS)
      return this.refuse('agent-stopped', `${this.name} stopped (exit code ${this.exitCode ?? 'unknown'}).${this.logTail()}`)
    } finally {
      this.turnActive = false
    }
  }

  private get exitCode(): number | null {
    return this.child?.exitCode ?? null
  }

  async cancel(): Promise<void> {
    if (!this.isReady) {
      // The start is not done. End it, and the process with it.
      this.aborted = true
      await this.close()
      return
    }
    const sessionId = this.sessionId
    if (sessionId === null || !this.connection) return
    await this.connection.agent.notify(methods.agent.session.cancel, { sessionId }).catch(() => undefined)
  }

  close(): Promise<void> {
    this.closing ??= this.shutdown()
    return this.closing
  }

  /** Cancel the turn, close the session, close stdin, then kill the whole process tree after a limit. */
  private async shutdown(): Promise<void> {
    this.aborted = true
    const child = this.child
    if (!child) return
    if (child.exitCode === null && child.signalCode === null) {
      const limit = this.options.closeLimitMs ?? CLOSE_LIMIT_MS
      const sessionId = this.sessionId
      if (this.connection && sessionId !== null && this.isReady) {
        const { agent } = this.connection
        if (this.turnActive) await agent.notify(methods.agent.session.cancel, { sessionId }).catch(() => undefined)
        if (this.capabilities?.agentCapabilities?.sessionCapabilities?.close) {
          await within(agent.request(methods.agent.session.close, { sessionId }), limit)
        }
      }
      child.stdin?.end()
      if (!(await within(this.ended, limit))) {
        await killTree(child)
        await within(this.ended, limit)
      }
    }
    this.connection?.close()
  }
}
