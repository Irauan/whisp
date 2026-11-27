import { describe, expect, it } from 'vitest'
import {
  entrySchema,
  failedTool,
  isDraft,
  isOpenTool,
  mergeTool,
  noticeOfModeChange,
  noticeOfStop,
  planEntry,
  sessionEventSchema,
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
