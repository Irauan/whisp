import { useCallback, useEffect, useRef, useState } from 'react'
import type { z } from 'zod'
import type { Result } from '../../building-blocks/result'
import { listSessions } from '../../features/sessions/list/list.contract'
import { addProfile } from '../../features/profiles/add/add.contract'
import { chooseDirectories } from '../../features/profiles/choose-directories/choose-directories.contract'
import { editProfile } from '../../features/profiles/edit/edit.contract'
import { listProfiles } from '../../features/profiles/list/list.contract'
import { removeProfile } from '../../features/profiles/remove/remove.contract'
import { switchProfile } from '../../features/profiles/switch/switch.contract'
import { invokeContract } from './invoke'

type Snapshot = z.output<typeof listProfiles.result>

export type ProfileView = Snapshot['profiles'][number]
export type Notice = Snapshot['notices'][number]
/** A session of the current profile. In this version it is a draft of the import, and it is read-only. */
export type SessionDraft = z.output<typeof listSessions.result>['sessions'][number]

export interface ProfileState {
  profiles: ProfileView[]
  currentId: string | null
  notices: Notice[]
  /** The sessions of the current profile, oldest first. */
  sessions: SessionDraft[]
}

/** The text of the error of a command, or null after a success. */
type Outcome = Promise<string | null>

/**
 * The state of the profiles. The main process owns it (decision 0002). The hook loads a
 * snapshot at the start and after each command that succeeds.
 */
export function useProfiles() {
  const [state, setState] = useState<ProfileState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)

  const load = useCallback(async () => {
    latest.current += 1
    const mine = latest.current
    const listed = await invokeContract(listProfiles, {})
    if (!listed.ok) {
      if (mine === latest.current) setError(`Aether could not read your profiles. ${listed.error.message}`)
      return
    }
    const { profiles, currentId, notices } = listed.value
    let sessions: SessionDraft[] = []
    if (currentId) {
      const found = await invokeContract(listSessions, { profileId: currentId })
      if (!found.ok) {
        if (mine === latest.current) setError(`Aether could not read your sessions. ${found.error.message}`)
        return
      }
      sessions = found.value.sessions
    }
    // A newer load replaces this one.
    if (mine !== latest.current) return
    setError(null)
    setState({ profiles, currentId, notices, sessions })
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
    chooseDirectories: async (directories: z.input<typeof chooseDirectories.input>['directories']): Outcome =>
      finish(await invokeContract(chooseDirectories, { directories })),
    add: async (input: z.input<typeof addProfile.input>): Outcome => finish(await invokeContract(addProfile, input)),
    edit: async (input: z.input<typeof editProfile.input>): Outcome =>
      finish(await invokeContract(editProfile, input)),
    switchTo: async (id: string): Outcome => finish(await invokeContract(switchProfile, { id })),
    remove: async (id: string): Outcome => finish(await invokeContract(removeProfile, { id }))
  }
}
