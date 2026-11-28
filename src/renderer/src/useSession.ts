import { useCallback, useEffect, useReducer, useState } from 'react'
import { openSession, SESSIONS_CHANGED, sessionEventSchema } from '../../features/sessions/open/open.contract'
import { invokeContract } from './invoke'
import { emptyWindowState, reduceSessionWindow, type SessionSnapshot } from './session-view'

export type SessionWindow =
  | { status: 'loading' }
  | { status: 'opened'; view: SessionSnapshot }
  | { status: 'missing' }
  | { status: 'failed'; message: string }

/**
 * The state of one session window. The main process owns the data (decision 0002). The hook loads a
 * snapshot, applies the events `sessions.changed` that follow it, and loads a new snapshot when it
 * sees a gap in their revisions. It subscribes before it loads, so that no event falls between.
 */
export function useSession(id: string): SessionWindow {
  const [state, dispatch] = useReducer(reduceSessionWindow, emptyWindowState)
  const [problem, setProblem] = useState<Exclude<SessionWindow, { status: 'loading' | 'opened' }> | null>(null)

  const load = useCallback(async () => {
    const result = await invokeContract(openSession, { id })
    if (result.ok) {
      setProblem(null)
      dispatch({ type: 'snapshot', snapshot: result.value })
    } else if (result.error.code === 'unknown-session') {
      setProblem({ status: 'missing' })
    } else {
      setProblem({ status: 'failed', message: result.error.message })
    }
  }, [id])

  useEffect(() => {
    const stop = window.aether.subscribe(SESSIONS_CHANGED, (payload) => {
      const event = sessionEventSchema.safeParse(payload)
      if (event.success && event.data.sessionId === id) dispatch({ type: 'event', event: event.data })
    })
    void load()
    return stop
  }, [id, load])

  useEffect(() => {
    if (state.needsSnapshot) void load()
  }, [state.needsSnapshot, load])

  if (problem) return problem
  return state.view ? { status: 'opened', view: state.view } : { status: 'loading' }
}
