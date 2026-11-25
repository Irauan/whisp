// Aether's own view of a coding agent. Nothing here names a vendor: every agent
// speaks the Agent Client Protocol (ACP), and the main process turns its
// messages into the entries below.

/** An agent that Aether can start, as the renderer sees it. */
export interface AgentInfo {
  id: string
  name: string
  /** False when Aether cannot find the agent's program on this machine. */
  available: boolean
  /** Why the agent is not available, or where its program is. */
  detail: string
}

export type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export type ChatEntry =
  | { kind: 'user'; text: string; at: string }
  | { kind: 'agent'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'tool'; id: string; title: string; toolKind: string; status: ToolStatus }
  | { kind: 'plan'; steps: { text: string; done: boolean }[] }
  | { kind: 'notice'; text: string; tone: 'info' | 'error' }

export interface PermissionChoice {
  id: string
  name: string
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'
}

export interface PermissionQuestion {
  requestId: string
  title: string
  choices: PermissionChoice[]
}

export type RunStatus = 'idle' | 'starting' | 'working' | 'error'

/** The agent conversation of one work item. */
export interface AgentRun {
  itemId: string
  agentId: string | null
  /** The agent's own session id, used to resume the conversation. */
  sessionId: string | null
  status: RunStatus
  entries: ChatEntry[]
  /** The agent waits for the user to allow or refuse a tool call. */
  question: PermissionQuestion | null
}

export const emptyRun = (itemId: string): AgentRun => ({
  itemId,
  agentId: null,
  sessionId: null,
  status: 'idle',
  entries: [],
  question: null
})

/**
 * The parts of an ACP `session/update` that Aether shows. The main process
 * passes the agent's update through unchanged; fields Aether does not use are
 * ignored, and unknown update kinds change nothing.
 */
export interface SessionUpdateLike {
  sessionUpdate: string
  content?: unknown
  toolCallId?: string
  title?: string | null
  kind?: string | null
  status?: string | null
  entries?: unknown
}

const TOOL_STATUSES: readonly ToolStatus[] = ['pending', 'in_progress', 'completed', 'failed']

function textOf(content: unknown): string | null {
  if (typeof content !== 'object' || content === null) return null
  const block = content as { type?: unknown; text?: unknown }
  return block.type === 'text' && typeof block.text === 'string' ? block.text : null
}

function toolStatus(value: unknown, fallback: ToolStatus): ToolStatus {
  return TOOL_STATUSES.includes(value as ToolStatus) ? (value as ToolStatus) : fallback
}

/** Adds streamed text to the last entry when it is of the same kind. */
function appendText(entries: ChatEntry[], kind: 'agent' | 'thought', text: string): ChatEntry[] {
  const last = entries.at(-1)
  if (last?.kind === kind) return [...entries.slice(0, -1), { kind, text: last.text + text }]
  return [...entries, { kind, text }]
}

export function applyUpdate(entries: ChatEntry[], update: SessionUpdateLike): ChatEntry[] {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
    case 'agent_thought_chunk': {
      const text = textOf(update.content)
      if (!text) return entries
      return appendText(entries, update.sessionUpdate === 'agent_message_chunk' ? 'agent' : 'thought', text)
    }
    case 'tool_call': {
      if (!update.toolCallId) return entries
      const id = update.toolCallId
      const tool: ChatEntry = {
        kind: 'tool',
        id,
        title: update.title || 'Tool call',
        toolKind: update.kind || 'other',
        status: toolStatus(update.status, 'pending')
      }
      // An agent may announce the same call again with more detail.
      const index = entries.findIndex((entry) => entry.kind === 'tool' && entry.id === id)
      if (index === -1) return [...entries, tool]
      return entries.map((entry, i) => (i === index ? tool : entry))
    }
    case 'tool_call_update':
      return entries.map((entry) =>
        entry.kind === 'tool' && entry.id === update.toolCallId
          ? {
              ...entry,
              title: update.title || entry.title,
              toolKind: update.kind || entry.toolKind,
              status: toolStatus(update.status, entry.status)
            }
          : entry
      )
    case 'plan': {
      if (!Array.isArray(update.entries)) return entries
      const steps = update.entries.flatMap((step: unknown) => {
        const { content, status } = (step ?? {}) as { content?: unknown; status?: unknown }
        return typeof content === 'string' ? [{ text: content, done: status === 'completed' }] : []
      })
      // A plan replaces the previous plan, which stays where it was.
      const index = entries.findLastIndex((entry) => entry.kind === 'plan')
      const plan: ChatEntry = { kind: 'plan', steps }
      if (index === -1) return [...entries, plan]
      return entries.map((entry, i) => (i === index ? plan : entry))
    }
    default:
      return entries
  }
}

/** Tool calls that never finished, for example because the agent stopped. */
export function settleTools(entries: ChatEntry[]): ChatEntry[] {
  return entries.map((entry) =>
    entry.kind === 'tool' && (entry.status === 'pending' || entry.status === 'in_progress')
      ? { ...entry, status: 'failed' }
      : entry
  )
}

export function isAgentRun(value: unknown): value is AgentRun {
  if (typeof value !== 'object' || value === null) return false
  const run = value as Partial<AgentRun>
  return typeof run.itemId === 'string' && Array.isArray(run.entries)
}
