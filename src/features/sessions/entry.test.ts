import { describe, expect, it } from 'vitest'
import {
  entrySchema,
  failedTool,
  isDraft,
  isOpenTool,
  isSamePlan,
  mergeTool,
  noticeOfModeChange,
  noticeOfStop,
  planEntry,
  sessionEventSchema,
  changeSchema,
  toolEntry,
  type Entry,
  type ToolEntry
} from './entry'

const tool: ToolEntry = { kind: 'tool', toolId: 't1', title: 'Run it', toolKind: 'execute', status: 'in_progress' }

describe('entrySchema', () => {
  it.each<Entry>([
    { kind: 'user', text: 'Say hello' },
    { kind: 'agent', text: 'Hello' },
    { kind: 'thought', text: 'hm' },
    tool,
    { kind: 'plan', steps: [{ text: 'One', status: 'pending' }, { text: 'Two', status: 'in_progress' }, { text: 'Three', status: 'completed' }] },
    { kind: 'notice', tone: 'error', text: 'Claude Code stopped.', code: 'agent-stopped' },
    { kind: 'notice', tone: 'info', text: 'Stopped.' }
  ])('accepts the entry %j', (entry) => {
    expect(entrySchema.parse(entry)).toEqual(entry)
  })

  it.each([
    null,
    {},
    { kind: 'user' },
    { kind: 'unknown', text: 'x' },
    { kind: 'user', text: 'x', extra: 1 },
    { kind: 'tool', toolId: 't', title: 't', toolKind: 'k', status: 'done' },
    { kind: 'plan', steps: [{ text: 'One', status: 'done' }] },
    { kind: 'plan', steps: [{ text: 'One', status: 'pending', priority: 'high' }] },
    { kind: 'notice', tone: 'loud', text: 'x' }
  ])('refuses the entry %j', (entry) => {
    expect(entrySchema.safeParse(entry).success).toBe(false)
  })
})

describe('sessionEventSchema', () => {
  const entry = { id: 'e1', entry: { kind: 'user', text: 'Hi' } }
  it.each([
    { sessionId: 's1', revision: 1, change: { type: 'entry-added', entry } },
    { sessionId: 's1', revision: 2, change: { type: 'entry-text', id: 'e1', text: 'more' } },
    { sessionId: 's1', revision: 3, change: { type: 'entry-replaced', entry } },
    { sessionId: 's1', revision: 4, change: { type: 'status', status: 'working' } }
  ])('accepts the event %j', (event) => {
    expect(sessionEventSchema.safeParse(event).success).toBe(true)
  })

  it.each([
    null,
    { sessionId: 's1', revision: 0, change: { type: 'status', status: 'idle' } },
    { sessionId: 's1', revision: 1.5, change: { type: 'status', status: 'idle' } },
    { sessionId: 's1', revision: 1, change: { type: 'status', status: 'sleeping' } },
    { sessionId: 's1', revision: 1, change: { type: 'unknown' } },
    { revision: 1, change: { type: 'status', status: 'idle' } }
  ])('refuses the event %j', (event) => {
    expect(sessionEventSchema.safeParse(event).success).toBe(false)
  })
})

describe('tool entries', () => {
  it('builds a tool entry from a tool update of the agent', () => {
    expect(toolEntry({ type: 'tool', id: 't1', title: 'Run it', toolKind: 'execute', status: 'in_progress' })).toEqual(tool)
  })

  it('merges an update and keeps what the update leaves out', () => {
    expect(mergeTool(tool, { type: 'tool-update', id: 't1', title: null, toolKind: null, status: 'completed' })).toEqual({
      ...tool,
      status: 'completed'
    })
    expect(mergeTool(tool, { type: 'tool-update', id: 't1', title: 'Run the tests', toolKind: 'test', status: null })).toEqual({
      ...tool,
      title: 'Run the tests',
      toolKind: 'test'
    })
  })

  it('finds the tool calls that did not finish, and fails them', () => {
    expect(isOpenTool(tool)).toBe(true)
    expect(isOpenTool({ ...tool, status: 'pending' })).toBe(true)
    expect(isOpenTool({ ...tool, status: 'completed' })).toBe(false)
    expect(isOpenTool({ ...tool, status: 'failed' })).toBe(false)
    expect(isOpenTool({ kind: 'agent', text: 'x' })).toBe(false)
    expect(failedTool(tool)).toEqual({ ...tool, status: 'failed' })
  })
})

describe('planEntry', () => {
  it('keeps the three states of each step and drops everything else', () => {
    const entry = planEntry({
      type: 'plan',
      steps: [
        { text: 'One', status: 'completed' },
        { text: 'Two', status: 'in_progress' },
        { text: 'Three', status: 'pending' }
      ]
    })
    expect(entry).toEqual({
      kind: 'plan',
      steps: [
        { text: 'One', status: 'completed' },
        { text: 'Two', status: 'in_progress' },
        { text: 'Three', status: 'pending' }
      ]
    })
    expect(entrySchema.safeParse(entry).success).toBe(true)
  })
})

describe('noticeOfStop', () => {
  it('says "Stopped." for a cancel', () => {
    expect(noticeOfStop('cancelled')).toMatchObject({ kind: 'notice', tone: 'info', text: 'Stopped.' })
  })

  it('gives an error for a limit and for a refusal, and nothing for a normal end', () => {
    for (const reason of ['max_tokens', 'max_turn_requests', 'refusal']) {
      expect(noticeOfStop(reason)).toMatchObject({ tone: 'error' })
    }
    expect(noticeOfStop('end_turn')).toBeNull()
  })
})

describe('noticeOfModeChange', () => {
  it('says that Claude uses Accept edits when Aether asked for Auto and the agent reports Accept edits', () => {
    const notice = noticeOfModeChange('auto', 'accept-edits')
    expect(notice).toMatchObject({ kind: 'notice', tone: 'info', code: 'auto-fallback' })
    expect(notice?.text).toMatch(/\bAuto\b[\s\S]*\bAccept edits\b/)
    expect(entrySchema.safeParse(notice).success).toBe(true)
  })

  it.each([
    ['auto', 'auto'],
    ['auto', 'plan'],
    ['auto', 'ask'],
    ['plan', 'accept-edits'],
    ['ask', 'accept-edits'],
    ['approve-all', 'accept-edits'],
    ['accept-edits', 'accept-edits']
  ] as const)('gives no notice when Aether asked for %s and the agent reports %s', (asked, reported) => {
    expect(noticeOfModeChange(asked, reported)).toBeNull()
  })
})

describe('isDraft', () => {
  const draft = { entryCount: 0, agentSessionId: null, status: 'idle' } as const
  it('is true for a session that was never started', () => {
    expect(isDraft(draft)).toBe(true)
  })

  it.each([{ entryCount: 1 }, { agentSessionId: 'a1' }, { status: 'starting' }, { status: 'working' }] as const)(
    'is false after %j',
    (change) => {
      expect(isDraft({ ...draft, ...change })).toBe(false)
    }
  )
})

describe('isSamePlan', () => {
  const steps = (...items: [string, 'pending' | 'in_progress' | 'completed'][]) => items.map(([text, status]) => ({ text, status }))

  it('is progress when the texts are the same, in the same order, with other states', () => {
    const first = steps(['One', 'pending'], ['Two', 'pending'])
    const next = steps(['One', 'completed'], ['Two', 'in_progress'])
    expect(isSamePlan({ kind: 'plan', steps: first }, { kind: 'plan', steps: next })).toBe(true)
    expect(isSamePlan({ kind: 'plan', steps: first }, { kind: 'plan', steps: first })).toBe(true)
  })

  it('is a new plan when a text differs, the order differs, or the number of steps differs', () => {
    const base = { kind: 'plan' as const, steps: steps(['One', 'pending'], ['Two', 'pending']) }
    expect(isSamePlan(base, { kind: 'plan', steps: steps(['One', 'pending'], ['Three', 'pending']) })).toBe(false)
    expect(isSamePlan(base, { kind: 'plan', steps: steps(['Two', 'pending'], ['One', 'pending']) })).toBe(false)
    expect(isSamePlan(base, { kind: 'plan', steps: steps(['One', 'pending']) })).toBe(false)
    expect(isSamePlan(base, { kind: 'plan', steps: steps(['One', 'pending'], ['Two', 'pending'], ['Three', 'pending']) })).toBe(false)
    expect(isSamePlan(base, { kind: 'plan', steps: [] })).toBe(false)
  })

  it('compares the texts as exact strings', () => {
    const base = { kind: 'plan' as const, steps: steps(['One', 'pending']) }
    expect(isSamePlan(base, { kind: 'plan', steps: steps(['one', 'pending']) })).toBe(false)
    expect(isSamePlan(base, { kind: 'plan', steps: steps(['One ', 'pending']) })).toBe(false)
  })

  it('counts two plans with no steps as the same plan', () => {
    expect(isSamePlan({ kind: 'plan', steps: [] }, { kind: 'plan', steps: [] })).toBe(true)
  })
})

describe('the entry answers', () => {
  const entry = { kind: 'answers', card: 'question', toolId: null, outcome: 'open', rows: [{ question: 'Which runner?', answer: null }] }

  it.each(['open', 'submitted', 'skipped', 'stopped', 'withdrawn', 'exited', 'quit', 'interrupted'])('accepts the outcome %s', (outcome) => {
    expect(entrySchema.parse({ ...entry, outcome })).toEqual({ ...entry, outcome })
  })

  it.each([
    { ...entry, outcome: 'released' },
    { ...entry, card: 'dialog' },
    { ...entry, rows: [{ question: 'q' }] },
    { ...entry, rows: [{ question: 'q', answer: null, extra: 1 }] },
    { ...entry, extra: 1 },
    { kind: 'answers', card: 'decision', outcome: 'open', rows: [] }
  ])('refuses the entry %j', (bad) => {
    expect(entrySchema.safeParse(bad).success).toBe(false)
  })
})

describe('the changes of a card, the live mode and the model', () => {
  const view = { id: 'e1', entry: { kind: 'answers', card: 'decision', toolId: 't1', outcome: 'open', rows: [{ question: 'Run this command?', answer: null }] } }
  const permission = { id: 'r1', entryId: 'e1', toolId: 't1', title: 'npm test', toolKind: 'execute', locations: [], options: [{ id: 'yes', label: 'Yes', kind: 'allow-once' }] }

  it.each([
    { type: 'card-opened', entry: view, card: { kind: 'permission', permission } },
    { type: 'card-opened', entry: view, card: { kind: 'elicitation', elicitation: { id: 'f1', entryId: 'e1', toolId: null, message: 'm', fields: [], recommended: null } } },
    { type: 'card-closed', entry: view, id: 'r1' },
    { type: 'mode', mode: 'approve-all' },
    { type: 'model', model: 'claude-opus-5-5' },
    { type: 'title', title: 'Greeting test' }
  ])('accepts the change %j', (change) => {
    expect(changeSchema.parse(change)).toEqual(change)
  })

  it.each([
    { type: 'card-opened', entry: view },
    { type: 'card-opened', entry: view, card: { kind: 'dialog' } },
    { type: 'card-closed', entry: view },
    { type: 'mode', mode: 'interactive' },
    { type: 'model' },
    { type: 'title' },
    { type: 'title', title: 'Greeting test', extra: true }
  ])('refuses the change %j', (change) => {
    expect(changeSchema.safeParse(change).success).toBe(false)
  })
})
