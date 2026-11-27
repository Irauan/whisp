import { z } from 'zod'
import type { AgentUpdate } from '../../building-blocks/agent.port'
import { MODE_LABELS, type Mode } from '../../building-blocks/mode'

/** The states of a tool call (ACP names them the same way). */
export const TOOL_STATUSES = ['pending', 'in_progress', 'completed', 'failed'] as const

/** The states of a step of a plan. Aether ignores the priority of a step. */
export const STEP_STATUSES = ['pending', 'in_progress', 'completed'] as const

/**
 * One entry of a conversation (architecture, Terms). The database holds each entry as one row with
 * this JSON, and the main process validates it on every write and every read.
 */
export const entrySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('user'), text: z.string() }),
  z.strictObject({ kind: z.literal('agent'), text: z.string() }),
  z.strictObject({ kind: z.literal('thought'), text: z.string() }),
  z.strictObject({
    kind: z.literal('tool'),
    toolId: z.string(),
    title: z.string(),
    toolKind: z.string(),
    status: z.enum(TOOL_STATUSES)
  }),
  // A plan entry keeps the state of each step, so that a later story can show the plan as a todo list.
  z.strictObject({
    kind: z.literal('plan'),
    steps: z.array(z.strictObject({ text: z.string(), status: z.enum(STEP_STATUSES) }))
  }),
  z.strictObject({
    kind: z.literal('notice'),
    tone: z.enum(['info', 'error']),
    text: z.string(),
    /** A short name for the cause, for example `not-signed-in` and `agent-stopped`. */
    code: z.string().optional()
  })
])

export type Entry = z.output<typeof entrySchema>
export type ToolEntry = Extract<Entry, { kind: 'tool' }>
export type TextKind = 'agent' | 'thought'

/** An entry with its ID. The ID is stable, so that an event can name the entry that it changes. */
export const entryViewSchema = z.strictObject({ id: z.string(), entry: entrySchema })

export type EntryView = z.output<typeof entryViewSchema>

/** What the session does now. The main process owns it, and it lives in memory only. */
export const SESSION_STATUSES = ['idle', 'starting', 'working'] as const
export const sessionStatusSchema = z.enum(SESSION_STATUSES)
export type SessionStatus = z.output<typeof sessionStatusSchema>

/** One change of a session that the renderer can apply. The renderer cannot read the database. */
export const changeSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('entry-added'), entry: entryViewSchema }),
  /** Text that the agent added at the end of a text or thought entry. */
  z.strictObject({ type: z.literal('entry-text'), id: z.string(), text: z.string() }),
  z.strictObject({ type: z.literal('entry-replaced'), entry: entryViewSchema }),
  z.strictObject({ type: z.literal('status'), status: sessionStatusSchema })
])

export type Change = z.output<typeof changeSchema>

/**
 * The event `sessions.changed` (decision 0002). The revision counts the changes of one session in
 * the main process, from 1. A gap in the revisions tells the renderer to load a new snapshot.
 */
export const sessionEventSchema = z.strictObject({
  sessionId: z.string(),
  revision: z.number().int().min(1),
  change: changeSchema
})

export type SessionEvent = z.output<typeof sessionEventSchema>

/** The name of the event of `sessionEventSchema`. */
export const SESSIONS_CHANGED = 'sessions.changed'

/** The entry for a tool call that the agent announces. */
export function toolEntry(update: Extract<AgentUpdate, { type: 'tool' }>): ToolEntry {
  return { kind: 'tool', toolId: update.id, title: update.title, toolKind: update.toolKind, status: update.status }
}

/** The tool entry after an update. A field that the update leaves out keeps its value. */
export function mergeTool(entry: ToolEntry, update: Extract<AgentUpdate, { type: 'tool-update' }>): ToolEntry {
  return {
    ...entry,
    title: update.title ?? entry.title,
    toolKind: update.toolKind ?? entry.toolKind,
    status: update.status ?? entry.status
  }
}

/** True for a tool call that did not finish. */
export const isOpenTool = (entry: Entry): entry is ToolEntry =>
  entry.kind === 'tool' && (entry.status === 'pending' || entry.status === 'in_progress')

/** The tool entry of a call that never finished, for example because the turn stopped. */
export const failedTool = (entry: ToolEntry): ToolEntry => ({ ...entry, status: 'failed' })

export type PlanEntry = Extract<Entry, { kind: 'plan' }>

/** The entry for a plan of the agent. */
export function planEntry(update: Extract<AgentUpdate, { type: 'plan' }>): PlanEntry {
  return { kind: 'plan', steps: update.steps.map(({ text, status }) => ({ text, status })) }
}

/**
 * True when the next plan is progress on the previous one: the same step texts, as exact strings,
 * in the same order. Only the states can differ. Any other plan is a new plan. Two plans with no
 * steps are the same plan. Progress replaces the entry in place, and a new plan adds an entry.
 */
export function isSamePlan(previous: PlanEntry, next: PlanEntry): boolean {
  return previous.steps.length === next.steps.length && previous.steps.every((step, index) => step.text === next.steps[index]?.text)
}

/** The text that the user sees for a stop reason that is not a normal end, or null for a normal end. */
export function noticeOfStop(reason: string): Extract<Entry, { kind: 'notice' }> | null {
  switch (reason) {
    case 'cancelled':
      return { kind: 'notice', tone: 'info', text: 'Stopped.', code: 'stopped' }
    case 'max_tokens':
      return { kind: 'notice', tone: 'error', text: 'The agent reached its output limit.', code: 'max-tokens' }
    case 'max_turn_requests':
      return { kind: 'notice', tone: 'error', text: 'The agent reached its limit of steps for one message.', code: 'max-steps' }
    case 'refusal':
      return { kind: 'notice', tone: 'error', text: 'The agent declined this request.', code: 'refusal' }
    default:
      return null
  }
}

/**
 * The notice for a mode that the agent uses and Aether did not ask for. Only the fallback that
 * Claude Code makes has one: a model that cannot use Auto makes Claude use Accept edits (decision
 * 0012, item 2). No other change of the mode gives a notice. The result is null then.
 */
export function noticeOfModeChange(asked: Mode, reported: Mode): Extract<Entry, { kind: 'notice' }> | null {
  if (asked !== 'auto' || reported !== 'accept-edits') return null
  return {
    kind: 'notice',
    tone: 'info',
    text: `${MODE_LABELS.auto} is not available for this model. Claude uses ${MODE_LABELS['accept-edits']}.`,
    code: 'auto-fallback'
  }
}

/**
 * A draft has no conversation yet. Its prompt waits in the composer, and the user can still change
 * its mode. A session is not a draft once it has an entry, an agent session or a turn.
 */
export function isDraft(state: { entryCount: number; agentSessionId: string | null; status: SessionStatus }): boolean {
  return state.entryCount === 0 && state.agentSessionId === null && state.status === 'idle'
}
