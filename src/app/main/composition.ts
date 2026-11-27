import { basename, join } from 'node:path'
import { systemClock, type Clock } from '../../building-blocks/clock.port'
import { AccountsInStart } from '../../building-blocks/accounts-in-start'
import type { AgentPort } from '../../building-blocks/agent.port'
import { openDatabase, type OpenError } from '../../building-blocks/database'
import { randomIds, type Ids } from '../../building-blocks/ids'
import type { GithubPort, GithubTokenPort } from '../../building-blocks/github.port'
import { MIGRATIONS } from '../../building-blocks/migrations'
import type { ProjectScanner } from '../../building-blocks/project-scanner.port'
import { ok, type Result } from '../../building-blocks/result'
import { ClaudeProjectScanner } from '../../providers/claude-code/project-scanner'
import { addProfile } from '../../features/profiles/add/add.contract'
import { addProfileController } from '../../features/profiles/add/add.controller'
import { chooseDirectories } from '../../features/profiles/choose-directories/choose-directories.contract'
import { chooseDirectoriesController } from '../../features/profiles/choose-directories/choose-directories.controller'
import { editProfile } from '../../features/profiles/edit/edit.contract'
import { editProfileController } from '../../features/profiles/edit/edit.controller'
import { importOldFilesHandler } from '../../features/profiles/import-old-files/import-old-files.handler'
import { ImportStore } from '../../features/profiles/import-old-files/import-old-files.store'
import { listGithubAccounts } from '../../features/profiles/list-github-accounts/list-github-accounts.contract'
import { listGithubAccountsController } from '../../features/profiles/list-github-accounts/list-github-accounts.controller'
import { listProfiles } from '../../features/profiles/list/list.contract'
import { listProfilesController } from '../../features/profiles/list/list.controller'
import { removeProfile as removeProfileContract } from '../../features/profiles/remove/remove.contract'
import { removeProfileController } from '../../features/profiles/remove/remove.controller'
import { switchProfile } from '../../features/profiles/switch/switch.contract'
import { switchProfileController } from '../../features/profiles/switch/switch.controller'
import type { Notice } from '../../features/profiles/profile'
import { ProfileStore } from '../../features/profiles/profile.store'
import { answerQuestion } from '../../features/repositories/answer-question/answer-question.contract'
import { answerQuestionController } from '../../features/repositories/answer-question/answer-question.controller'
import { checkDirectoryHandler } from '../../features/repositories/check-directory/check-directory.handler'
import { listQuestions } from '../../features/repositories/list-questions/list-questions.contract'
import { listQuestionsController } from '../../features/repositories/list-questions/list-questions.controller'
import { QUESTIONS_CHANGED } from '../../features/repositories/question'
import { Questions } from '../../features/repositories/questions.store'
import { TrustStore } from '../../features/repositories/trust.store'
import { SESSIONS_CHANGED } from '../../features/sessions/entry'
import { RELEASE_LIMITS } from '../../features/sessions/idle-release'
import { Processes } from '../../features/sessions/processes.store'
import { recordAgentUpdateHandler } from '../../features/sessions/record-agent-update/record-agent-update.handler'
import { retireIdleHandler } from '../../features/sessions/retire-idle/retire-idle.handler'
import { sendMessage } from '../../features/sessions/send-message/send-message.contract'
import { sendMessageController } from '../../features/sessions/send-message/send-message.controller'
import { SessionStore } from '../../features/sessions/session.store'
import { setMode } from '../../features/sessions/set-mode/set-mode.contract'
import { setModeController } from '../../features/sessions/set-mode/set-mode.controller'
import { setModel } from '../../features/sessions/set-model/set-model.contract'
import { setModelController } from '../../features/sessions/set-model/set-model.controller'
import { stopSession } from '../../features/sessions/stop/stop.contract'
import { stopSessionController } from '../../features/sessions/stop/stop.controller'
import { Transcript } from '../../features/sessions/transcript.store'
import { createSession } from '../../features/sessions/create/create.contract'
import { createSessionController } from '../../features/sessions/create/create.controller'
import { deleteSession } from '../../features/sessions/delete/delete.contract'
import { deleteSessionController } from '../../features/sessions/delete/delete.controller'
import { listSessions } from '../../features/sessions/list/list.contract'
import { listSessionsController } from '../../features/sessions/list/list.controller'
import { openSession } from '../../features/sessions/open/open.contract'
import { openSessionController } from '../../features/sessions/open/open.controller'
import type { Controller } from './ipc'

/** The name of the database in the data folder (`userData`). */
export const DATABASE_FILE = 'aether.db'

/** The old file that the import reads. Aether never writes it. */
export const OLD_WORKSPACE_FILE = 'workspace.json'

/** How often the release of idle agent processes runs (decision 0006, spec S9, rule 1). */
export const RETIRE_INTERVAL_MS = 30_000

export interface Composition {
  /** The controller of each contract in the registry, by contract name. */
  controllers: Record<string, Controller>
  /** The messages about the start. The snapshot of the profiles carries them to the window. */
  notices: Notice[]
  /**
   * Ends the agent processes: it cancels the turns, closes the sessions and the stdin of the
   * processes, and kills the process trees after a limit. The caller waits for it before it quits,
   * and closes the database after it.
   */
  shutdown(): Promise<void>
  /** Closes the database. */
  close(): void
}

export interface CompositionDeps {
  /** The data folder: `userData`. */
  dataDir: string
  github: GithubPort & GithubTokenPort
  /** The agent port. The entry point of the app passes the ACP port with the recipe of Claude Code. */
  agents: AgentPort
  /** Finds the hooks and MCP servers that the agent runs in a folder. The default reads the files of Claude Code. */
  scanner?: ProjectScanner
  /** Sends an event to the subscribers of its name. */
  publish(name: string, payload: unknown): void
  clock?: Clock
  ids?: Ids
  log?(message: string, cause?: unknown): void
}

/**
 * Opens the database, runs the import of the old files and connects the controllers.
 * It returns an error when the database cannot open: a newer version, or a failure that Aether
 * cannot repair. The caller then tells the user and exits, and Aether writes nothing.
 * An unreadable database or `workspace.json` is not an error: the start goes on, with a notice.
 */
export function composeMain({
  dataDir,
  github,
  agents,
  scanner = new ClaudeProjectScanner(),
  publish,
  clock = systemClock,
  ids = randomIds,
  log = (message, cause) => console.error(message, cause)
}: CompositionDeps): Result<Composition, OpenError> {
  const opened = openDatabase(join(dataDir, DATABASE_FILE), MIGRATIONS, () => clock.now())
  if (!opened.ok) return opened
  const { database, keptAside } = opened.value

  const notices: Notice[] = []
  if (keptAside) {
    notices.push({
      code: 'database-unreadable',
      message: `Aether could not read its database. It kept the file as ${basename(keptAside)} and started with a new database.`
    })
  }

  const imported = importOldFilesHandler({
    profiles: new ProfileStore(database),
    imports: new ImportStore(database),
    clock,
    ids,
    file: join(dataDir, OLD_WORKSPACE_FILE)
  })
  if (!imported.ok) notices.push({ code: 'workspace-file-unreadable', message: imported.error.message })

  // The state of the sessions that lives in memory: the conversation and the agent processes.
  const sessionStore = new SessionStore(database)
  const transcript = new Transcript(sessionStore, (event) => publish(SESSIONS_CHANGED, event), clock, ids)
  const processes = new Processes()
  // The edit of an account and the first start of a session share this set (decision 0014).
  const startingAccounts = new AccountsInStart()
  // The slices never call each other, so the composition root connects them: the agent process of a
  // session reports its progress to `record-agent-update`.
  const record = (sessionId: string, update: Parameters<typeof recordAgentUpdateHandler>[1]['update']) =>
    recordAgentUpdateHandler({ transcript, store: sessionStore }, { sessionId, update })
  // The questions of the main process (decision 0007): the trust question and the directory questions.
  const questions = new Questions((event) => publish(QUESTIONS_CHANGED, event), ids)
  const trust = new TrustStore(database)
  // The gate that `send-message` calls before it starts a process. The slices never call each other,
  // so the composition root passes the gate as a function.
  const guard = (request: { sessionId: string; profileId: string; folder: string }) =>
    checkDirectoryHandler({ store: trust, questions, scanner, clock }, request)
  const release = async (sessionId: string) => {
    // An open question would hold its turn, so a release answers it first.
    questions.cancelSession(sessionId)
    trust.forgetSession(sessionId)
    transcript.forget(sessionId)
    await processes.release(sessionId)
  }
  // The release of idle agent processes (decision 0006). A timer runs it for rule 1, and the end of
  // each turn for rule 2. It never rejects. A tick after the shutdown does nothing.
  let stopped = false
  const retireIdle = () => {
    if (!stopped) void retireIdleHandler({ store: sessionStore, transcript, processes, clock, limits: RELEASE_LIMITS, log })
  }
  const retireTimer = setInterval(retireIdle, RETIRE_INTERVAL_MS)
  retireTimer.unref()
  const stopRetiring = () => {
    stopped = true
    clearInterval(retireTimer)
  }
  const stop = stopSessionController({ store: sessionStore, transcript, processes })
  const removeProfile = removeProfileController(database)

  return ok({
    controllers: {
      [listGithubAccounts.name]: listGithubAccountsController(github),
      [listProfiles.name]: listProfilesController(database, () => notices),
      [chooseDirectories.name]: chooseDirectoriesController(database),
      [addProfile.name]: addProfileController(database, clock, ids),
      [editProfile.name]: editProfileController(database, clock, ids, startingAccounts),
      [switchProfile.name]: switchProfileController(database),
      // Removing a profile removes its sessions. Their agent processes end first.
      [removeProfileContract.name]: async (input: { id: string }) => {
        // The closes run together: each one lists its process tree, so one by one the wait would add up.
        await Promise.all(sessionStore.idsByProfile(input.id).map(release))
        return removeProfile(input)
      },
      [listSessions.name]: listSessionsController(database),
      [createSession.name]: createSessionController(database, clock, ids),
      [openSession.name]: openSessionController(database, transcript),
      [sendMessage.name]: sendMessageController({ store: sessionStore, transcript, processes, agents, github, starting: startingAccounts, record, guard, turnEnded: retireIdle, clock, ids, log }),
      // Stop also answers "cancel" for the open question of the session. The turn then ends with "Stopped.".
      [stopSession.name]: async (input: { id: string }) => {
        const result = await stop(input)
        questions.cancelSession(input.id)
        return result
      },
      [listQuestions.name]: listQuestionsController(questions),
      [answerQuestion.name]: answerQuestionController({ questions }),
      [setMode.name]: setModeController({ store: sessionStore, transcript }),
      [setModel.name]: setModelController({ store: sessionStore, transcript }),
      [deleteSession.name]: deleteSessionController(database, release)
    },
    notices,
    shutdown: () => {
      // The timer stops first: no release runs while the processes end, or after the database closes.
      stopRetiring()
      // A turn that waits for an answer never ends by itself. Answer "cancel" first, or the quit waits for ever.
      questions.cancelAll()
      return processes.releaseAll()
    },
    close: () => {
      stopRetiring()
      database.close()
    }
  })
}
