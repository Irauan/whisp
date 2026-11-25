import { useEffect, useState } from 'react'
import { emptyRun, type AgentInfo, type AgentRun } from '../../shared/agent'

/** The agent conversation of one work item, kept current. */
export function useAgentRun(itemId: string) {
  const [run, setRun] = useState<AgentRun>(() => emptyRun(itemId))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setRun(emptyRun(itemId))
    setError(null)
    // Subscribe first, so that no change between the load and the subscription is lost.
    const stop = window.aether.onAgentRun((next) => {
      if (active && next.itemId === itemId) setRun(next)
    })
    window.aether.getAgentRun(itemId).then(
      (loaded) => {
        if (active) setRun((current) => (current.entries.length > 0 || current.status !== 'idle' ? current : loaded))
      },
      (cause: unknown) => {
        if (active) setError(`Aether could not read this conversation. ${String(cause)}`)
      }
    )
    return () => {
      active = false
      stop()
    }
  }, [itemId])

  return { run, error, setError }
}

export function useAgents() {
  const [agents, setAgents] = useState<AgentInfo[] | null>(null)
  useEffect(() => {
    let active = true
    window.aether.listAgents().then(
      (list) => active && setAgents(list),
      () => active && setAgents([])
    )
    return () => {
      active = false
    }
  }, [])
  return agents
}
