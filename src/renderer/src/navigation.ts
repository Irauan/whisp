import { useCallback, useState } from 'react'

export type View =
  | { kind: 'home' }
  | { kind: 'pulls' }
  | { kind: 'items' }
  | { kind: 'bots' }
  | { kind: 'customize' }
  | { kind: 'accounts' }
  | { kind: 'project'; projectId: string }
  | { kind: 'item'; itemId: string }
  | { kind: 'session'; sessionId: string }

export interface History {
  entries: View[]
  index: number
}

function sameView(a: View | undefined, b: View): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function push(history: History, view: View): History {
  if (sameView(history.entries[history.index], view)) return history
  const entries = [...history.entries.slice(0, history.index + 1), view]
  return { entries, index: entries.length - 1 }
}

export function step(history: History, offset: number): History {
  const index = history.index + offset
  return index < 0 || index >= history.entries.length ? history : { ...history, index }
}

const start: History = { entries: [{ kind: 'home' }], index: 0 }

export function useNavigation() {
  const [history, setHistory] = useState<History>(start)
  const go = useCallback((view: View) => setHistory((current) => push(current, view)), [])
  const back = useCallback(() => setHistory((current) => step(current, -1)), [])
  const forward = useCallback(() => setHistory((current) => step(current, 1)), [])
  const reset = useCallback(() => setHistory(start), [])
  const view: View = history.entries[history.index] ?? { kind: 'home' }
  return {
    view,
    go,
    back,
    forward,
    reset,
    canGoBack: history.index > 0,
    canGoForward: history.index < history.entries.length - 1
  }
}
