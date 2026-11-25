import { describe, expect, it } from 'vitest'
import { applyUpdate, settleTools, type ChatEntry } from './agent'

const text = (value: string) => ({ type: 'text', text: value })

describe('applyUpdate', () => {
  it('joins streamed text into one message', () => {
    let entries: ChatEntry[] = []
    entries = applyUpdate(entries, { sessionUpdate: 'agent_message_chunk', content: text('Hel') })
    entries = applyUpdate(entries, { sessionUpdate: 'agent_message_chunk', content: text('lo') })
    expect(entries).toEqual([{ kind: 'agent', text: 'Hello' }])
  })

  it('starts a new message after a tool call', () => {
    let entries: ChatEntry[] = [{ kind: 'agent', text: 'Reading' }]
    entries = applyUpdate(entries, { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Read App.tsx', kind: 'read' })
    entries = applyUpdate(entries, { sessionUpdate: 'agent_message_chunk', content: text('Done') })
    expect(entries.map((entry) => entry.kind)).toEqual(['agent', 'tool', 'agent'])
  })

  it('updates a tool call in place', () => {
    let entries = applyUpdate([], { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Run tests', status: 'pending' })
    entries = applyUpdate(entries, { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' })
    expect(entries).toEqual([{ kind: 'tool', id: 't1', title: 'Run tests', toolKind: 'other', status: 'completed' }])
  })

  it('replaces the plan', () => {
    let entries = applyUpdate([], { sessionUpdate: 'plan', entries: [{ content: 'Read', status: 'pending' }] })
    entries = applyUpdate(entries, { sessionUpdate: 'plan', entries: [{ content: 'Read', status: 'completed' }] })
    expect(entries).toEqual([{ kind: 'plan', steps: [{ text: 'Read', done: true }] }])
  })

  it('ignores updates that Aether does not show', () => {
    const entries: ChatEntry[] = []
    expect(applyUpdate(entries, { sessionUpdate: 'usage_update' })).toBe(entries)
    expect(applyUpdate(entries, { sessionUpdate: 'agent_message_chunk', content: { type: 'image' } })).toBe(entries)
  })
})

describe('settleTools', () => {
  it('marks unfinished tool calls as failed', () => {
    const entries: ChatEntry[] = [
      { kind: 'tool', id: 'a', title: 'A', toolKind: 'read', status: 'in_progress' },
      { kind: 'tool', id: 'b', title: 'B', toolKind: 'read', status: 'completed' }
    ]
    expect(settleTools(entries).map((entry) => entry.kind === 'tool' && entry.status)).toEqual(['failed', 'completed'])
  })
})
