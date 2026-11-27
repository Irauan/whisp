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
   * The settings of the provider, as the first start of the session saved them. The provider
   * parses and translates them. A provider that does not know them refuses the start.
   */
  settings: Readonly<Record<string, unknown>>
  /** The variables that Aether sets for the agent, for example `GH_TOKEN`. The provider adds its own. */
  environment: Readonly<Record<string, string>>
  /** The ID of the agent session to continue, or null to start a new one. */
  resume: string | null
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

/** What the process tells Aether without being asked. */
export interface AgentListener {
  update(update: AgentUpdate): void
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
  /** Sends one user message and resolves when the turn ends. It waits for `ready`. */
  prompt(text: string): Promise<Result<StopReason, PromptErrorCode>>
  /** Cancels the turn. Before `ready` it cancels the start. It never rejects. */
  cancel(): Promise<void>
  /**
   * Ends the process: it cancels the turn, closes the session, closes stdin, and kills the whole
   * process tree after a limit. It never rejects.
   */
  close(): Promise<void>
}

export interface AgentPort {
  /** Starts a new process at once. The process is not ready before `ready` resolves. */
  start(input: AgentStartInput, listener: AgentListener): AgentProcess
}
