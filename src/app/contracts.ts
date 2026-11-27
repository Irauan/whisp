import type { Contract } from '../building-blocks/contract'
import { createSession } from '../features/sessions/create/create.contract'
import { deleteSession } from '../features/sessions/delete/delete.contract'
import { listSessions } from '../features/sessions/list/list.contract'
import { SESSIONS_CHANGED } from '../features/sessions/entry'
import { openSession } from '../features/sessions/open/open.contract'
import { sendMessage } from '../features/sessions/send-message/send-message.contract'
import { setMode } from '../features/sessions/set-mode/set-mode.contract'
import { stopSession } from '../features/sessions/stop/stop.contract'
import { addProfile } from '../features/profiles/add/add.contract'
import { chooseDirectories } from '../features/profiles/choose-directories/choose-directories.contract'
import { editProfile } from '../features/profiles/edit/edit.contract'
import { listGithubAccounts } from '../features/profiles/list-github-accounts/list-github-accounts.contract'
import { listProfiles } from '../features/profiles/list/list.contract'
import { removeProfile } from '../features/profiles/remove/remove.contract'
import { switchProfile } from '../features/profiles/switch/switch.contract'

/** The registry. `invoke` accepts only the names of these contracts. */
export const contracts: readonly Contract[] = [
  listGithubAccounts,
  listProfiles,
  chooseDirectories,
  addProfile,
  editProfile,
  switchProfile,
  removeProfile,
  listSessions,
  createSession,
  openSession,
  sendMessage,
  stopSession,
  setMode,
  deleteSession
]

/**
 * The registry of events. `subscribe` accepts only these names.
 * `sessions.changed` carries one change of a session and its revision (decision 0002).
 */
export const events: readonly string[] = [SESSIONS_CHANGED]
