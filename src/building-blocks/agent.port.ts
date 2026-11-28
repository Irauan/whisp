import type { Mode } from './mode'
import type { Result } from './result'

/**
 * The boundary to an agent. The port is neutral: it names no vendor and no protocol. A provider
 * translates it. Decision 0006: each session has its own agent process.
 */

/** A shared skill or MCP server that the session gets (decision 0008). The library is not built yet, so the list is empty. */
export type SharedItem = never

/** Everything that a provider needs to start the agent of one session. The caller reads it from the session row. */
export interface AgentStartInput {
  /** The folder that the session runs in. An absolute path. */
  mainDirectory: string
  /** More folders that the agent can reach. Absolute paths. */
  additionalDirectories: readonly string[]
  /** The model ID, or `default` to keep the model of the agent. */
  model: string
  mode: Mode
  sharedItems: readonly SharedItem[]
  /**
   * The settings of the provider account that this agent run uses. The provider parses and
   * translates them. A provider that does not know them refuses the start.
   */
  settings: Readonly<Record<string, unknown>>
  /** The variables that Aether sets for the agent, for example `GH_TOKEN`. The provider adds its own. */
  environment: Readonly<Record<string, string>>
  /** The ID of the agent session to continue, or null to start a new one. */
  resume: string | null
}

/** A file or folder that the first message of a session names. The provider turns it into the link of its protocol. */
export interface PromptLink {
  /** An absolute path. */
  path: string
  /** The name that the agent shows, for example the file name. */
  name: string
}

/** One step of a plan of the agent. */
export type PlanStepStatus = 'pending' | 'in_progress' | 'completed'

export type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

/** A change that the agent reports during a turn. Aether ignores the kinds that it does not show. */
export type AgentUpdate =
  | { type: 'text'; text: string }
  | { type: 'thought'; text: string }
  | { type: 'tool'; id: string; title: string; toolKind: string; status: ToolStatus }
  | { type: 'tool-update'; id: string; title: string | null; toolKind: string | null; status: ToolStatus | null }
  | { type: 'plan'; steps: { text: string; status: PlanStepStatus }[] }
  /** The agent uses this mode now. Aether asked for a mode at the start, and the agent can use another one. */
  | { type: 'mode'; mode: Mode }
  /** The agent uses another model now, for example after the refusal fallback. It comes only when the model changes. */
  | { type: 'model'; model: string }
  /** The agent names the session. The title is as the agent wrote it: the caller cleans it. It names no protocol. */
  | { type: 'title'; title: string }

export type PermissionOptionKind = 'allow-once' | 'allow-always' | 'refuse-once' | 'refuse-always'

/** One choice of a permission request. */
export interface PermissionOption {
  /** The ID of the choice, as the agent gave it. */
  id: string
  /** The name of the choice, as the agent wrote it. */
  label: string
  kind: PermissionOptionKind
  /** True for the option that the provider adds to a request with no option. It only cancels, and it is never recommended. */
  cancel?: boolean
}

/** A question of the agent: may it use a tool? It stays open until the user answers or the agent withdraws it. */
export interface PermissionRequest {
  /** Made by Aether, unique in the process. */
  id: string
  /** The ID of the tool call of the agent. */
  toolId: string
  /** The title of the tool call. Null when neither the request nor an earlier announcement of the call gave one. */
  title: string | null
  /** The kind of the tool call, from the request or from the earlier announcement of the call. Null when neither gave one. */
  toolKind: string | null
  locations: string[]
  options: PermissionOption[]
}

export interface ElicitationChoice {
  value: string
  label: string
  description: string | null
}

/**
 * One field of a form of the agent. A `choice` is a single select, `choices` a multi select, and
 * `text` a line of free text. `other` links a text field to the choice field that it completes
 * (for example the "Other" row of a question): the provider sets it, the window shows the text in
 * the row of that field.
 */
export type ElicitationField =
  | { key: string; kind: 'choice'; title: string | null; description: string | null; options: ElicitationChoice[] }
  | { key: string; kind: 'choices'; title: string | null; description: string | null; options: ElicitationChoice[] }
  | { key: string; kind: 'text'; title: string | null; description: string | null; completes: string | null }

/** A form that the agent asks the user to fill (an elicitation of mode form). */
export interface Elicitation {
  /** Made by Aether, unique in the process. */
  id: string
  /** The ID of the tool call that asks, or null for a form of an MCP server. */
  toolId: string | null
  message: string
  fields: ElicitationField[]
  /**
   * The value of the choice that Aether shows first and as the primary button, or null. The recipe
   * of the agent decides it (for example "Keep the refusal"); the provider puts that option first.
   */
  recommended: string | null
  /** True when the answer can be saved as the user typed it. False for a form that can hold a secret. */
  keepsText: boolean
}

export type ElicitationAnswer = { action: 'submit'; values: Record<string, string | string[]> } | { action: 'skip' }

export type CloseReason = 'withdrawn' | 'exited'

/** What the process tells Aether without being asked. */
export interface AgentListener {
  update(update: AgentUpdate): void
  /** A new permission request is open. */
  permission(request: PermissionRequest): void
  /**
   * The agent withdrew a request, or the process exited with the request open. The provider calls it
   * only for a close that the caller did not start: `cancel` and `close` report nothing, because the
   * caller names the reason of a close that it starts.
   */
  permissionClosed(requestId: string, reason: CloseReason): void
  /** A new form is open. */
  elicitation(request: Elicitation): void
  /** As `permissionClosed`, for a form. */
  elicitationClosed(id: string, reason: CloseReason): void
  /** The process ended. `logTail` holds the last lines of its log, with the secrets removed. */
  exited(info: { code: number | null; logTail: string }): void
}

export type StartErrorCode =
  /** Aether cannot find the program of the agent. */
  | 'unavailable'
  /** Nobody is signed in. The message holds the sign-in steps. */
  | 'not-signed-in'
  /** The agent did not accept the mode or the model. The session does not start (decision 0007). */
  | 'settings-refused'
  /** The caller cancelled the start. */
  | 'cancelled'
  | 'failed'

export type PromptErrorCode = 'not-signed-in' | 'agent-stopped' | 'failed'

export interface Started {
  /** The ID of the agent session. The caller saves it, so that a later process can resume it. */
  agentSessionId: string
  /** True when the agent continued the session that the caller named in `resume`. */
  resumed: boolean
  /** The reason that the resume failed, when the caller asked to resume and the agent could not. The agent then started a new session. */
  resumeError: string | null
}

export type StopReason = 'end_turn' | 'cancelled' | 'max_tokens' | 'max_turn_requests' | 'refusal'

/** The agent process of one session. */
export interface AgentProcess {
  /** Resolves when the agent session exists, with the mode and the model applied. */
  readonly ready: Promise<Result<Started, StartErrorCode>>
  /**
   * Sends one user message and resolves when the turn ends. It waits for `ready`. Each link is a
   * file or folder that the message names. The caller sends links with the first message only.
   */
  prompt(text: string, links?: readonly PromptLink[]): Promise<Result<StopReason, PromptErrorCode>>
  /**
   * Cancels the turn, and answers each open permission request and form with "cancelled". Before
   * `ready` it cancels the start. It never rejects. It reports no closed request.
   */
  cancel(): Promise<void>
  /** Answers one open permission request with one of its options. Nothing changes on an error. */
  answer(requestId: string, optionId: string): Result<true, 'unknown-request' | 'unknown-option'>
  /** Answers one open form. Nothing changes on an error. */
  answerElicitation(id: string, answer: ElicitationAnswer): Result<true, 'unknown-request' | 'invalid-answer'>
  /**
   * Ends the process: it answers each open request with "cancelled", cancels the turn, closes the
   * session, closes stdin, and kills the whole process tree after a limit. It never rejects. It
   * reports no closed request.
   */
  close(): Promise<void>
}

export interface AgentPort {
  /** Starts a new process at once. The process is not ready before `ready` resolves. */
  start(input: AgentStartInput, listener: AgentListener): AgentProcess
}
