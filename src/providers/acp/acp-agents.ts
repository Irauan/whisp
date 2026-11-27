import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
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
  type CreateElicitationResponse,
  type InitializeResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionUpdate
} from '@agentclientprotocol/sdk'
import { allowedEnvironment } from '../../building-blocks/agent-environment'
import type {
  AgentListener,
  AgentPort,
  AgentProcess,
  AgentStartInput,
  AgentUpdate,
  Elicitation,
  ElicitationAnswer,
  ElicitationField,
  PermissionOptionKind,
  PermissionRequest,
  PromptErrorCode,
  PromptLink,
  StartErrorCode,
  Started,
  StopReason,
  ToolStatus
} from '../../building-blocks/agent.port'
import { fitsFields } from '../../building-blocks/elicitation'
import type { Mode } from '../../building-blocks/mode'
import { err, ok, type Result } from '../../building-blocks/result'
import { LOG_MARKER } from '../../shared/log-marker'
import { fieldsOfSchema } from './forms'
import { endSurvivors, processTree, system32, TOOL_LIMIT_MS, type Log, type Powershell, type ProcessRow } from './process-tree'
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
  /** Where Aether tells a failure that no notice shows, for example a failed list of the child processes. `console.error` by default. */
  log?: Log
  /** Runs the PowerShell scripts of the process tree. A test passes a runner that it controls. */
  powershell?: Powershell
  /** Ends a process and its tree. `taskkill /T /F` by default. A test passes a function that it watches. */
  killTree?: (child: ChildProcess) => Promise<void>
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

/** The JSON-RPC code of a request that the peer cancelled with `$/cancel_request`. */
const REQUEST_CANCELLED = -32800

const PERMISSION_KINDS: Readonly<Record<string, PermissionOptionKind>> = {
  allow_once: 'allow-once',
  allow_always: 'allow-always',
  reject_once: 'refuse-once',
  reject_always: 'refuse-always'
}

const CANCELLED: RequestPermissionResponse = { outcome: { outcome: 'cancelled' } }

/** The option that a request with no option gets: the only way to close its card. It answers "cancelled". */
const CANCEL_OPTION = { id: 'aether-cancel-request', label: 'Cancel request', kind: 'refuse-once' } as const

/** What Aether remembers about a tool call that the agent announced, for the request that asks about it. */
interface KnownTool {
  title: string | null
  kind: string | null
  locations: string[] | null
}

/** A permission request that waits for the user. The promise of the handler resolves with `resolve`. */
interface PendingPermission {
  request: PermissionRequest
  resolve(response: RequestPermissionResponse): void
}

/** A form that waits for the user. */
interface PendingElicitation {
  form: Elicitation
  resolve(response: CreateElicitationResponse): void
}

/** The parameters of `elicitation/create` that Aether reads. */
interface FormRequest {
  mode?: unknown
  sessionId?: unknown
  toolCallId?: unknown
  message?: unknown
  requestedSchema?: unknown
}

/** The value of the option `model` in a list of configuration options of the agent, or null. */
function modelOfOptions(options: unknown): string | null {
  if (!Array.isArray(options)) return null
  for (const option of options as unknown[]) {
    if (typeof option !== 'object' || option === null) continue
    const { id, currentValue } = option as { id?: unknown; currentValue?: unknown }
    if (id === 'model' && typeof currentValue === 'string') return currentValue
  }
  return null
}

/** True when the signal aborted because the agent cancelled the request, not because the connection closed. */
const cancelledByPeer = (signal: AbortSignal): boolean => signal.reason instanceof RequestError && signal.reason.code === REQUEST_CANCELLED

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

/** Kills the process and all its children. On Windows `child.kill` ends only the parent. The call has a time limit. */
function killTree(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    const { pid } = child
    if (process.platform !== 'win32' || pid === undefined) {
      child.kill()
      resolve()
      return
    }
    execFile(system32('taskkill.exe'), ['/pid', String(pid), '/T', '/F'], { windowsHide: true, timeout: TOOL_LIMIT_MS }, () => resolve())
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
  /** True from the cancel of a running turn until the turn ends. A request that comes then gets "cancelled" at once. */
  private cancelling = false
  private readonly permissions = new Map<string, PendingPermission>()
  private readonly elicitations = new Map<string, PendingElicitation>()
  /** The tool calls that the agent announced, by ID. A permission request of the real adapter names only the ID. */
  private readonly tools = new Map<string, KnownTool>()
  /** The model that the agent reported last. A later report of another model is a change. */
  private modelBase: string | null = null
  private stderr = ''
  private closing: Promise<void> | null = null
  /** The Unix times, in ms, of the call of `spawn` and of its `spawn` event. The process of the agent started between them. */
  private spawnCalled = 0
  private spawnedAt = 0
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
  private logLines(): string {
    return this.redact(this.stderr.trim().split('\n').slice(-LOG_LINES).join('\n'))
  }

  /** The log lines after a message, behind the marker line that the session window splits at. Empty when there are none. */
  private logTail(): string {
    const tail = this.logLines()
    return tail ? `\n${LOG_MARKER}\n${tail}` : ''
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
        // Aether shows the forms of the agent as cards (story S5). It declares no URL elicitation.
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, elicitation: { form: {} } }
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
      this.spawnCalled = Date.now()
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
        // A request that is still open ends with the process. The caller names the reason of a close that
        // it started, so only an exit that it did not start reports here.
        this.reportExit()
        this.markEnded()
        this.listener.exited({ code, logTail: this.logLines() })
      })
      child.once('spawn', () => {
        this.spawnedAt = Date.now()
        this.connection = client({ name: 'Aether' })
          .onNotification(methods.client.session.update, ({ params }) => {
            if (params.sessionId !== this.sessionId) return
            this.remember(params.update)
            const update = translateUpdate(params.update, (id) => this.options.recipe.modeOf(id))
            if (update) this.listener.update(update)
            const model = this.modelChange(params.update)
            if (model !== null) this.listener.update({ type: 'model', model })
          })
          // The requests stay open until the user answers, the agent withdraws them or the process ends.
          // Any session ID is accepted: one process serves one session (spec S5, open choice 6).
          .onRequest(methods.client.session.requestPermission, ({ params, signal }) => this.askPermission(params, signal))
          .onRequest(methods.client.elicitation.create, ({ params, signal }) => this.askElicitation(params as unknown as FormRequest, signal))
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
      let resumed: { configOptions?: unknown } | void = undefined
      try {
        if (abilities?.sessionCapabilities?.resume) {
          resumed = await this.context.request(methods.agent.session.resume, { sessionId: resume, mcpServers: [], ...folders })
        } else if (abilities?.loadSession) {
          // Loading replays the conversation, which Aether has saved. The updates of the replay
          // find no session ID yet, so Aether drops them.
          resumed = await this.context.request(methods.agent.session.load, { sessionId: resume, mcpServers: [], ...folders })
        } else {
          throw new Error(`${this.name} cannot continue an earlier session.`)
        }
        this.sessionId = resume
        this.modelBase = modelOfOptions(resumed?.configOptions)
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
    this.modelBase = modelOfOptions(created.configOptions)
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
        const changed = await this.context.request(methods.agent.session.setConfigOption, {
          sessionId,
          configId: 'model',
          value: this.input.model
        })
        this.modelBase = modelOfOptions(changed.configOptions) ?? this.modelBase
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
      this.cancelling = false
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
    // A request that comes while the cancel of the turn runs gets "cancelled" at once.
    if (this.turnActive) this.cancelling = true
    // The open requests get their answer before the agent gets the cancel. The agent then sees the
    // answer first, and a request that it withdraws on the cancel finds its answer already sent.
    await this.cancelRequests()
    await this.connection.agent.notify(methods.agent.session.cancel, { sessionId }).catch(() => undefined)
  }

  answer(requestId: string, optionId: string): Result<true, 'unknown-request' | 'unknown-option'> {
    const pending = this.permissions.get(requestId)
    if (!pending) return err('unknown-request', 'This permission request is closed.')
    if (!pending.request.options.some((option) => option.id === optionId)) return err('unknown-option', 'The request did not offer this option.')
    this.permissions.delete(requestId)
    pending.resolve(optionId === CANCEL_OPTION.id ? CANCELLED : { outcome: { outcome: 'selected', optionId } })
    return ok(true)
  }

  answerElicitation(id: string, answer: ElicitationAnswer): Result<true, 'unknown-request' | 'invalid-answer'> {
    const pending = this.elicitations.get(id)
    if (!pending) return err('unknown-request', 'This question of the agent is closed.')
    if (!fitsFields(pending.form.fields, answer)) return err('invalid-answer', 'The form did not offer this answer.')
    this.elicitations.delete(id)
    pending.resolve(answer.action === 'skip' ? { action: 'decline' } : { action: 'accept', content: answer.values })
    return ok(true)
  }

  /**
   * Answers each open request with "cancelled" (a form with "cancel"), and reports nothing: the caller
   * of `cancel` and `close` names the reason. It waits one turn of the event loop, so that the
   * answers are written before the caller writes anything else.
   */
  private async cancelRequests(): Promise<void> {
    const permissions = [...this.permissions.values()]
    const elicitations = [...this.elicitations.values()]
    this.permissions.clear()
    this.elicitations.clear()
    for (const pending of permissions) pending.resolve(CANCELLED)
    for (const pending of elicitations) pending.resolve({ action: 'cancel' })
    if (permissions.length + elicitations.length > 0) await new Promise<void>((resolve) => setImmediate(resolve))
  }

  /** Reports each request that the process left open when it exited by itself. A close that the caller started reports nothing. */
  private reportExit(): void {
    if (this.aborted) return
    const permissions = [...this.permissions.keys()]
    const elicitations = [...this.elicitations.keys()]
    this.permissions.clear()
    this.elicitations.clear()
    for (const id of permissions) this.tell(() => this.listener.permissionClosed(id, 'exited'))
    for (const id of elicitations) this.tell(() => this.listener.elicitationClosed(id, 'exited'))
  }

  /** Calls the listener. A defect of the caller never breaks the connection. */
  private tell(call: () => void): void {
    try {
      call()
    } catch (cause) {
      const log = this.options.log ?? ((message: string, detail?: unknown) => console.error(message, detail ?? ''))
      log('Aether could not handle a request of the agent.', cause)
    }
  }

  /** Remembers the kind, the title and the locations of a tool call, for the request that names only its ID. */
  private remember(update: SessionUpdate): void {
    if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update') return
    const known = this.tools.get(update.toolCallId)
    this.tools.set(update.toolCallId, {
      title: update.title || known?.title || null,
      kind: update.kind || known?.kind || null,
      locations: update.locations ? update.locations.map((location) => location.path) : (known?.locations ?? null)
    })
  }

  /** The new model of a `config_option_update`, or null when the model did not change. Only a started session reports it. */
  private modelChange(update: SessionUpdate): string | null {
    if (update.sessionUpdate !== 'config_option_update' || !this.isReady) return null
    const model = modelOfOptions(update.configOptions)
    if (model === null) return null
    const changed = this.modelBase !== null && model !== this.modelBase
    this.modelBase = model
    return changed ? model : null
  }

  private askPermission(params: RequestPermissionRequest, signal: AbortSignal): Promise<RequestPermissionResponse> {
    // After Stop, while the cancel runs, or while the process closes: no card.
    if (this.aborted || this.cancelling || signal.aborted) return Promise.resolve(CANCELLED)
    const known = this.tools.get(params.toolCall.toolCallId)
    const options = params.options.flatMap((option) => {
      const kind = PERMISSION_KINDS[option.kind]
      return kind === undefined ? [] : [{ id: option.optionId, label: option.name, kind }]
    })
    const request: PermissionRequest = {
      id: randomUUID(),
      toolId: params.toolCall.toolCallId,
      title: params.toolCall.title || known?.title || null,
      toolKind: params.toolCall.kind || known?.kind || null,
      locations: params.toolCall.locations ? params.toolCall.locations.map((location) => location.path) : (known?.locations ?? []),
      options: options.length > 0 ? options : [CANCEL_OPTION]
    }
    return new Promise((resolve) => {
      const pending: PendingPermission = { request, resolve }
      this.permissions.set(request.id, pending)
      signal.addEventListener(
        'abort',
        () => {
          // The agent withdrew the request. A closed connection is an exit, which the exit of the process reports.
          if (!cancelledByPeer(signal) || this.permissions.get(request.id) !== pending) return
          this.permissions.delete(request.id)
          // The agent waits for an answer to a request that it withdrew, so it gets "cancelled".
          resolve(CANCELLED)
          if (!this.aborted) this.tell(() => this.listener.permissionClosed(request.id, 'withdrawn'))
        },
        { once: true }
      )
      try {
        this.listener.permission(request)
      } catch (cause) {
        this.permissions.delete(request.id)
        this.tell(() => {
          throw cause
        })
        resolve(CANCELLED)
      }
    })
  }

  private askElicitation(params: FormRequest, signal: AbortSignal): Promise<CreateElicitationResponse> {
    if (params.mode !== 'form' || typeof params.message !== 'string') throw RequestError.invalidParams(undefined, 'Aether shows only forms.')
    const parsed = fieldsOfSchema(params.requestedSchema)
    if (parsed === null) throw RequestError.invalidParams(undefined, 'Aether cannot show this form.')
    if (this.aborted || this.cancelling || signal.aborted) return Promise.resolve({ action: 'cancel' })
    const toolId = typeof params.toolCallId === 'string' ? params.toolCallId : null
    const facts = this.options.recipe.formFacts({
      toolId,
      fields: parsed.map((field) => ({ key: field.key, kind: field.kind, values: field.kind === 'text' ? [] : field.options.map((option) => option.value) }))
    })
    const fields: ElicitationField[] = parsed.map((field) => {
      if (field.kind === 'text') return { ...field, completes: facts.completes[field.key] ?? null }
      // The recommended option comes first. The others keep the order of the agent.
      const options = [...field.options.filter((option) => option.value === facts.recommended), ...field.options.filter((option) => option.value !== facts.recommended)]
      return { ...field, options }
    })
    const form: Elicitation = { id: randomUUID(), toolId, message: params.message, fields, recommended: facts.recommended, keepsText: facts.keepsText }
    return new Promise((resolve) => {
      const pending: PendingElicitation = { form, resolve }
      this.elicitations.set(form.id, pending)
      signal.addEventListener(
        'abort',
        () => {
          if (!cancelledByPeer(signal) || this.elicitations.get(form.id) !== pending) return
          this.elicitations.delete(form.id)
          resolve({ action: 'cancel' })
          if (!this.aborted) this.tell(() => this.listener.elicitationClosed(form.id, 'withdrawn'))
        },
        { once: true }
      )
      try {
        this.listener.elicitation(form)
      } catch (cause) {
        this.elicitations.delete(form.id)
        this.tell(() => {
          throw cause
        })
        resolve({ action: 'cancel' })
      }
    })
  }

  close(): Promise<void> {
    this.closing ??= this.shutdown()
    return this.closing
  }

  /**
   * Spec rule 9, with the tree of S9-4: cancel the turn, close the session, close stdin, then kill the
   * whole process tree after a limit. The cancel and the list of the tree start in one step, and the
   * list comes before the close of the session and of stdin: a child of an agent that ended has no
   * parent to find. At the end, end each process of the tree that still runs.
   *
   * User decision 2026-11-27: when the list fails or times out (the log says so), the close ends the
   * agent and its whole tree with `taskkill /T /F` at once, only while the root still runs (the exit
   * state is read after the list), so that `/T` finds the children and no reused number is hit. It skips the close of the session and of stdin. The process then counts as
   * closed for the next start, as after any close.
   *
   * Each step has a limit, so the quit limit of the app covers the worst case: the list 5 s, the close
   * of the session 3 s, the end of the agent after stdin 3 s, `taskkill` 5 s, the end after the kill 3 s,
   * the kill of the survivors 5 s. That is 24 s. The turn that waits for the exit adds 2 s. A failed
   * list takes less: the list 5 s, `taskkill` 5 s and the end after the kill 3 s.
   */
  private async shutdown(): Promise<void> {
    this.aborted = true
    // The open requests get "cancelled" before anything else, as the agent still runs.
    await this.cancelRequests()
    const child = this.child
    if (!child) return
    if (child.exitCode === null && child.signalCode === null) {
      const limit = this.options.closeLimitMs ?? CLOSE_LIMIT_MS
      const tools = { log: this.options.log ?? ((message: string, cause?: unknown) => console.error(message, cause ?? '')), run: this.options.powershell }
      const sessionId = this.sessionId
      const live = this.connection && sessionId !== null && this.isReady ? { agent: this.connection.agent, sessionId } : null
      // Step 1: the cancel and the list start together, so the list overlaps the end of the turn.
      const cancelled = live && this.turnActive ? within(live.agent.notify(methods.agent.session.cancel, { sessionId: live.sessionId }), limit) : Promise.resolve(true)
      const listing: Promise<ProcessRow[] | null> =
        child.pid === undefined ? Promise.resolve([]) : processTree(child.pid, { from: this.spawnCalled, to: this.spawnedAt }, tools)
      const [, tree] = await Promise.all([cancelled, listing])
      if (tree === null) {
        // The list failed: end the agent and its whole tree now, but only while the agent still runs.
        // The list took up to 5 s. If the agent ended meanwhile, Windows can have given its number to
        // another process, so a kill by that number could end a foreign tree. The exit state of the
        // child decides, not the reason of the failure: a clock jump fails the window check of a live agent.
        if (child.exitCode === null && child.signalCode === null) {
          await (this.options.killTree ?? killTree)(child)
          if (!(await within(this.ended, limit))) tools.log('The agent did not end after the forced kill of its tree.')
        } else {
          tools.log('The agent ended while the list of its processes ran, so Aether does not kill by its number.')
        }
      } else {
        // Step 2: close the session. Step 3: close stdin.
        if (live && this.capabilities?.agentCapabilities?.sessionCapabilities?.close) {
          await within(live.agent.request(methods.agent.session.close, { sessionId: live.sessionId }), limit)
        }
        child.stdin?.end()
        if (!(await within(this.ended, limit))) {
          await killTree(child)
          await within(this.ended, limit)
        }
        // A child of the agent never outlives the close. This also ends a child that `taskkill` cannot find any more.
        await endSurvivors(tree, tools)
      }
    }
    this.connection?.close()
  }
}
