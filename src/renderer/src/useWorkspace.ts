import { useCallback, useEffect, useRef, useState } from 'react'
import { reduce, type Action, type Workspace } from '../../shared/model'

export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [error, setError] = useState<string | null>(null)
  const current = useRef<Workspace | null>(null)

  useEffect(() => {
    let active = true
    window.aether
      .loadWorkspace()
      .then((loaded) => {
        if (!active) return
        current.current = loaded
        setWorkspace(loaded)
      })
      .catch((cause: unknown) => {
        if (active) setError(`Aether could not read your workspace. ${String(cause)}`)
      })
    return () => {
      active = false
    }
  }, [])

  const dispatch = useCallback((action: Action) => {
    if (!current.current) return
    const next = reduce(current.current, action)
    if (next === current.current) return
    current.current = next
    setWorkspace(next)
    window.aether.saveWorkspace(next).then(
      () => setError(null),
      (cause: unknown) => setError(`Aether could not save your last change. ${String(cause)}`)
    )
  }, [])

  return { workspace, error, dispatch }
}
