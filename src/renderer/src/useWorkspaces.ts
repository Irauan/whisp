import { useCallback, useEffect, useRef, useState } from 'react'
import type { z } from 'zod'
import type { Result } from '../../building-blocks/result'
import { listSessions } from '../../features/sessions/list/list.contract'
import { addWorkspace } from '../../features/workspaces/add/add.contract'
import { chooseRoots } from '../../features/workspaces/choose-roots/choose-roots.contract'
import { editWorkspace } from '../../features/workspaces/edit/edit.contract'
import { listWorkspaces } from '../../features/workspaces/list/list.contract'
import { removeWorkspace } from '../../features/workspaces/remove/remove.contract'
import { switchWorkspace } from '../../features/workspaces/switch/switch.contract'
import { invokeContract } from './invoke'

type Snapshot = z.output<typeof listWorkspaces.result>

export type WorkspaceView = Snapshot['workspaces'][number]
export type Notice = Snapshot['notices'][number]
/** A session of the current workspace. In this version it is a draft of the import, and it is read-only. */
export type SessionDraft = z.output<typeof listSessions.result>['sessions'][number]

export interface WorkspaceState {
  workspaces: WorkspaceView[]
  currentId: string | null
  notices: Notice[]
  /** The sessions of the current workspace, oldest first. */
  sessions: SessionDraft[]
}

/** The text of the error of a command, or null after a success. */
type Outcome = Promise<string | null>

/**
 * The state of the workspaces. The main process owns it (decision 0002). The hook loads a
 * snapshot at the start and after each command that succeeds.
 */
export function useWorkspaces() {
  const [state, setState] = useState<WorkspaceState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)

  const load = useCallback(async () => {
    latest.current += 1
    const mine = latest.current
    const listed = await invokeContract(listWorkspaces, {})
    if (!listed.ok) {
      if (mine === latest.current) setError(`Aether could not read your workspaces. ${listed.error.message}`)
      return
    }
    const { workspaces, currentId, notices } = listed.value
    let sessions: SessionDraft[] = []
    if (currentId) {
      const found = await invokeContract(listSessions, { workspaceId: currentId })
      if (!found.ok) {
        if (mine === latest.current) setError(`Aether could not read your sessions. ${found.error.message}`)
        return
      }
      sessions = found.value.sessions
    }
    // A newer load replaces this one.
    if (mine !== latest.current) return
    setError(null)
    setState({ workspaces, currentId, notices, sessions })
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** Loads a new snapshot after a success. Returns the text of an error. */
  const finish = useCallback(
    async (result: Result<unknown, string>): Outcome => {
      if (!result.ok) return result.error.message
      await load()
      return null
    },
    [load]
  )

  return {
    state,
    error,
    chooseRoots: async (roots: z.input<typeof chooseRoots.input>['roots']): Outcome =>
      finish(await invokeContract(chooseRoots, { roots })),
    add: async (input: z.input<typeof addWorkspace.input>): Outcome => finish(await invokeContract(addWorkspace, input)),
    edit: async (input: z.input<typeof editWorkspace.input>): Outcome =>
      finish(await invokeContract(editWorkspace, input)),
    switchTo: async (id: string): Outcome => finish(await invokeContract(switchWorkspace, { id })),
    remove: async (id: string): Outcome => finish(await invokeContract(removeWorkspace, { id }))
  }
}
