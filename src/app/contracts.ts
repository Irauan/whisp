import type { Contract } from '../building-blocks/contract'
import { answerElicitation } from '../features/sessions/answer-elicitation/answer-elicitation.contract'
import { answerPermission } from '../features/sessions/answer-permission/answer-permission.contract'
import { createSession } from '../features/sessions/create/create.contract'
import { deleteSession } from '../features/sessions/delete/delete.contract'
import { listSessions } from '../features/sessions/list/list.contract'
import { SESSIONS_CHANGED } from '../features/sessions/entry'
import { openSession } from '../features/sessions/open/open.contract'
import { sendMessage } from '../features/sessions/send-message/send-message.contract'
import { setMode } from '../features/sessions/set-mode/set-mode.contract'
import { setModel } from '../features/sessions/set-model/set-model.contract'
import { stopSession } from '../features/sessions/stop/stop.contract'
import { answerQuestion } from '../features/repositories/answer-question/answer-question.contract'
import { listQuestions } from '../features/repositories/list-questions/list-questions.contract'
import { QUESTIONS_CHANGED } from '../features/repositories/question'
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
  answerPermission,
  answerElicitation,
  setMode,
  setModel,
  deleteSession,
  listQuestions,
  answerQuestion
]

/**
 * The registry of events. `subscribe` accepts only these names.
 * `sessions.changed` carries one change of a session and its revision (decision 0002).
 * `repositories.questions-changed` carries one change of the open questions and its revision.
 */
export const events: readonly string[] = [SESSIONS_CHANGED, QUESTIONS_CHANGED]
