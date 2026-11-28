import { useCallback, useEffect, useRef, useState } from 'react'
import type { z } from 'zod'
import type { Result } from '../../building-blocks/result'
import { addFolder } from '../../features/folders/add/add.contract'
import { removeFolder } from '../../features/folders/remove/remove.contract'
import { setFolderCollapsed } from '../../features/folders/set-collapsed/set-collapsed.contract'
import { createSession } from '../../features/sessions/create/create.contract'
import { deleteSession } from '../../features/sessions/delete/delete.contract'
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
/** A session of the current profile, with its unread mark and its live state (story S11). */
export type SessionView = z.output<typeof listSessions.result>['sessions'][number]
/** A folder of the current profile: a group of the sidebar. */
export type FolderView = z.output<typeof listSessions.result>['folders'][number]
export type Mode = SessionView['mode']

export interface ProfileState {
  profiles: ProfileView[]
  currentId: string | null
  notices: Notice[]
  /** The sessions of the current profile, oldest first. */
  sessions: SessionView[]
  /** The folders of the current profile, the newest activity first. */
  folders: FolderView[]
  /** The mode that a new session of the current profile starts with. The main process decides it. */
  newSessionMode: Mode
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
  // The collapsed state that the user chose and the main process may not have saved yet. A snapshot
  // that was late must not undo a click, so each snapshot takes these values on top of its own.
  const collapsedChoices = useRef(new Map<string, boolean>())

  const load = useCallback(async () => {
    latest.current += 1
    const mine = latest.current
    const listed = await invokeContract(listProfiles, {})
    if (!listed.ok) {
      if (mine === latest.current) setError(`Aether could not read your profiles. ${listed.error.message}`)
      return
    }
    const { profiles, currentId, notices } = listed.value
    let sessions: SessionView[] = []
    let folders: FolderView[] = []
    let newSessionMode: Mode = 'ask'
    if (currentId) {
      const found = await invokeContract(listSessions, { profileId: currentId })
      if (!found.ok) {
        if (mine === latest.current) setError(`Aether could not read your sessions. ${found.error.message}`)
        return
      }
      sessions = found.value.sessions
      folders = found.value.folders.map((folder) => ({ ...folder, collapsed: collapsedChoices.current.get(folder.id) ?? folder.collapsed }))
      newSessionMode = found.value.newSessionMode
    }
    // A newer load replaces this one.
    if (mine !== latest.current) return
    setError(null)
    setState({ profiles, currentId, notices, sessions, folders, newSessionMode })
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

  /**
   * Saves the collapsed state of a folder. The group changes at once, and no snapshot loads after the
   * save: a snapshot that is late must not undo a later click. After a failure the snapshot loads again.
   */
  const setCollapsed = useCallback(
    (folderId: string, collapsed: boolean): void => {
      collapsedChoices.current.set(folderId, collapsed)
      setState((current) =>
        current ? { ...current, folders: current.folders.map((folder) => (folder.id === folderId ? { ...folder, collapsed } : folder)) } : current
      )
      void invokeContract(setFolderCollapsed, { folderId, collapsed }).then((saved) => {
        if (saved.ok) return
        collapsedChoices.current.delete(folderId)
        void load()
      })
    },
    [load]
  )

  return {
    state,
    error,
    /** Loads a new snapshot. A command outside this hook calls it after a change that the snapshot holds, for example the mode of a draft. */
    reload: load,
    chooseDirectories: async (directories: z.input<typeof chooseDirectories.input>['directories']): Outcome =>
      finish(await invokeContract(chooseDirectories, { directories })),
    add: async (input: z.input<typeof addProfile.input>): Outcome => finish(await invokeContract(addProfile, input)),
    edit: async (input: z.input<typeof editProfile.input>): Outcome =>
      finish(await invokeContract(editProfile, input)),
    switchTo: async (id: string): Outcome => finish(await invokeContract(switchProfile, { id })),
    remove: async (id: string): Outcome => finish(await invokeContract(removeProfile, { id })),
    /**
     * Creates a session. The snapshot loads again before the call returns, so that the caller can
     * open the new session at once. On a failure it returns the text of the error.
     */
    createSession: async (input: z.input<typeof createSession.input>): Promise<{ id: string } | { message: string }> => {
      const created = await invokeContract(createSession, input)
      if (!created.ok) return { message: created.error.message }
      await load()
      return { id: created.value.id }
    },
    /**
     * Adds a folder to the sidebar of a profile. The snapshot loads again. On a failure it returns the
     * text of the error.
     */
    addFolder: async (profileId: string, path: string): Outcome => finish(await invokeContract(addFolder, { profileId, path })),
    /** Removes an empty folder from the sidebar. The snapshot loads again. */
    removeFolder: async (folderId: string): Outcome => finish(await invokeContract(removeFolder, { folderId })),
    setCollapsed,
    /** Deletes a session. A session that is gone already counts as deleted, and the snapshot loads again. */
    deleteSession: async (id: string): Outcome => {
      const deleted = await invokeContract(deleteSession, { id })
      if (!deleted.ok && deleted.error.code !== 'unknown-session') return deleted.error.message
      await load()
      return null
    }
  }
}
