import type { AccountsInStart } from '../../../building-blocks/accounts-in-start'
import type { AgentPort, AgentProcess, AgentStartInput, AgentUpdate } from '../../../building-blocks/agent.port'
import type { Clock } from '../../../building-blocks/clock.port'
import { isExistingFolder } from '../../../building-blocks/folder'
import type { GithubTokenPort } from '../../../building-blocks/github.port'
import type { Ids } from '../../../building-blocks/ids'
import { err, ok, type Result } from '../../../building-blocks/result'
import { noticeOfStop, type Entry } from '../entry'
import type { Processes, Turn } from '../processes.store'
import { MESSAGES, PROVIDER_KIND, textForAgent, unsupportedAttachment, type Session } from '../session'
import type { AgentRun, ProviderAccount, SessionStore } from '../session.store'
import type { Transcript } from '../transcript.store'
import { additionalDirectoriesOf, linksOf } from './attachments.handler'
import type { SendMessageError } from './send-message.contract'

export interface SendMessageDeps {
  store: SessionStore
  transcript: Transcript
  processes: Processes
  agents: AgentPort
  github: GithubTokenPort
  /**
   * The accounts that a first start uses now. An edit of such an account makes a new current account,
   * so the account that the agent run names always holds the settings that its process started with.
   */
  starting: AccountsInStart
  /** Passes an update of the agent to the slice `record-agent-update`. The composition root connects them. */
  record(sessionId: string, update: AgentUpdate): void
  /**
   * The gate before an agent process starts (decision 0007). The composition root connects it to the
   * directory and trust questions of the feature `repositories`. An error is a refusal: its code and
   * message make the notice. It takes values only: the main process reads them from the saved session.
   */
  guard: StartGuard
  clock: Clock
  ids: Ids
  log(message: string, cause?: unknown): void
}

/** What the gate needs to know about a start. A resume is a start too. */
export interface StartRequest {
  sessionId: string
  profileId: string
  /** The folder that the process starts in. */
  folder: string
}

export type StartGuard = (request: StartRequest) => Promise<Result<unknown, string>>

export interface SendMessage {
  /** Whether Aether accepted the message. It does not wait for the reply. */
  result: Result<Record<string, never>, SendMessageError>
  /** Resolves when the turn ends. It never rejects. A test awaits it. The controller does not. */
  finished: Promise<void>
}

const refused = (error: SendMessageError, message: string): SendMessage => ({ result: err(error, message), finished: Promise.resolve() })

/**
 * Sends one message to the agent of a session. The part before the first `await` is synchronous:
 * it checks the session, marks the turn and saves the message of the user. So a second send for
 * the same session, in the same moment, finds a turn that runs, and the renderer shows the message
 * at once. The rest runs as `finished`: it starts the agent process of the session when it has
 * none, sends the message and ends the turn.
 */
export function sendMessageHandler(deps: SendMessageDeps, input: { id: string; text: string }): SendMessage {
  const { store, transcript, processes } = deps
  const session = store.find(input.id)
  if (!session) return refused('unknown-session', MESSAGES.unknownSession)
  if (transcript.statusOf(session.id) !== 'idle') return refused('turn-active', MESSAGES.turnActive)
  const running = processes.get(session.id)
  // The folder can change after the session was created. A new process needs it, so check it again.
  if (!running && !isExistingFolder(session.sourcePath)) return refused('invalid-folder', MESSAGES.folderMissing)
  // A start reads the attachments of the row. Refuse the kinds that Aether cannot send, before any process starts.
  const unsupported = running ? null : unsupportedAttachment(session.attachments)
  if (unsupported !== null) return refused('unsupported-attachment', unsupported)

  const turn = processes.beginTurn(session.id)
  transcript.setStatus(session.id, running ? 'working' : 'starting')
  transcript.addEntry(session.id, { kind: 'user', text: input.text })

  const finished = drive(deps, session, input.text, turn).catch((cause: unknown) => deps.log('A turn failed.', cause))
  processes.track(finished)
  return { result: ok({}), finished }
}

const notice = (tone: 'info' | 'error', text: string, code: string): Entry => ({ kind: 'notice', tone, text, code })

/** Runs the turn. A defect becomes a notice, so the session never stays in a state that shows no way out. */
async function drive(deps: SendMessageDeps, session: Session, text: string, turn: Turn): Promise<void> {
  const { transcript, processes } = deps
  const id = session.id
  try {
    // The links and the URLs go with the first message: the turn that creates the first agent run.
    // A first start that failed saved no run, so its retry still counts as the first message.
    const first = !processes.get(id) && deps.store.agentRunOf(id) === null
    const agent = await ensureProcess(deps, session, turn)
    if (agent === null) return
    transcript.setStatus(id, 'working')
    const outcome = first ? await agent.prompt(textForAgent(text, session.attachments), linksOf(session)) : await agent.prompt(text)
    if (outcome.ok) {
      const stop = noticeOfStop(outcome.value)
      if (stop) transcript.addEntry(id, stop)
    } else if (turn.stopped) {
      // The user stopped the turn, or Aether is closing the process. Stop only sends a cancel, so the
      // process can be alive when the prompt fails. Never drop a live process without a close: it
      // holds GH_TOKEN. Only an agent that stopped by itself needs no close.
      processes.drop(id, agent)
      if (outcome.error.code !== 'agent-stopped') await agent.close()
      transcript.addEntry(id, notice('info', 'Stopped.', 'stopped'))
    } else {
      if (outcome.error.code === 'agent-stopped') processes.drop(id, agent)
      transcript.addEntry(id, notice('error', outcome.error.message, outcome.error.code))
    }
  } catch (cause) {
    deps.log('A turn failed.', cause)
    transcript.addEntry(id, notice('error', 'Something went wrong. Aether could not finish this message.', 'defect'))
  } finally {
    transcript.flush(id)
    transcript.failOpenTools(id)
    processes.endTurn(id, turn)
    transcript.setStatus(id, 'idle')
  }
}

/** The process of the session. It is the process of an earlier turn, or a new one. Null means that the turn ended already. */
async function ensureProcess(deps: SendMessageDeps, session: Session, turn: Turn): Promise<AgentProcess | null> {
  const { processes } = deps
  const id = session.id
  const existing = processes.get(id)
  if (existing) return existing

  // No process, no account and no token exist before the answer. This holds for a resume too.
  const permission = await deps.guard({ sessionId: id, profileId: session.profileId, folder: session.sourcePath })
  if (!permission.ok) {
    // A stop makes the guard refuse, so the turn tells a stop from the answer of the user.
    deps.transcript.addEntry(id, turn.stopped ? notice('info', 'Stopped.', 'stopped') : notice('info', permission.error.message, permission.error.code))
    return null
  }

  const prepared = await prepareStart(deps, session)
  try {
    return await startProcess(deps, session, turn, prepared)
  } finally {
    // The agent run names the account now, or the start failed. The account no longer counts as in a start.
    if (prepared.run === null) deps.starting.end(prepared.providerId)
  }
}

/** Starts the process of the session, waits until it is ready, and saves the agent run. */
async function startProcess(deps: SendMessageDeps, session: Session, turn: Turn, prepared: Prepared): Promise<AgentProcess | null> {
  const { store, transcript, processes } = deps
  const id = session.id
  if (turn.stopped) {
    transcript.addEntry(id, notice('info', 'Stopped.', 'stopped'))
    return null
  }
  const agent: AgentProcess = deps.agents.start(prepared.input, {
    update: (update) => deps.record(id, update),
    exited: () => processes.drop(id, agent)
  })
  processes.set(id, agent)
  const ready = await agent.ready
  if (!ready.ok) {
    // The provider ends a process that did not start. The close is idempotent, and no process is dropped alive.
    processes.drop(id, agent)
    await agent.close()
    transcript.addEntry(
      id,
      ready.error.code === 'cancelled'
        ? notice('info', 'Stopped.', 'stopped')
        : notice('error', ready.error.message, ready.error.code === 'not-signed-in' ? 'not-signed-in' : 'start-failed')
    )
    return null
  }

  // The agent session exists: save the agent run with the account that the process started with
  // (decision 0014). A resume that failed gives a new agent session in the same run.
  const { agentSessionId, resumeError } = ready.value
  if (prepared.run === null) {
    store.saveFirstRun(id, { id: deps.ids.next(), providerId: prepared.providerId, externalId: agentSessionId, createdAt: deps.clock.now().toISOString() })
  } else if (agentSessionId !== prepared.run.externalId) {
    store.saveExternalId(prepared.run.id, agentSessionId)
  }
  if (resumeError !== null) {
    transcript.addEntry(
      id,
      notice('info', `Aether could not continue the earlier conversation, so a new one starts. ${resumeError}`, 'resume-failed')
    )
  }
  if (turn.stopped) {
    transcript.addEntry(id, notice('info', 'Stopped.', 'stopped'))
    return null
  }
  return agent
}

interface Prepared {
  input: AgentStartInput
  /** The agent run of an earlier start. Null before the first start. */
  run: AgentRun | null
  /** The account that the process starts with. A resume uses the account of its run. A first start holds it in `starting`. */
  providerId: string
}

/**
 * Reads what the process needs from the saved session, never from the renderer: the folder, the
 * mode and the model of the row, and the GitHub token of the profile. The account comes from the
 * agent run when the session has one: a resume uses the account of its run. Without a run, the
 * first start reads the current account of the profile at that moment (decision 0014), so a retry
 * after a failed first start uses the account that the user fixed. It creates an empty account when
 * the profile has none. The account stays in `starting` until the start ends.
 */
async function prepareStart(deps: SendMessageDeps, session: Session): Promise<Prepared> {
  const { store, transcript, github, ids, clock, starting } = deps
  const run = store.agentRunOf(session.id)
  const account: ProviderAccount =
    run !== null
      ? { id: run.providerId, settings: run.settings }
      : store.ensureCurrentProvider(session.profileId, PROVIDER_KIND, ids.next(), clock.now().toISOString())
  // No code between the read of the account and this call can wait: an edit cannot change the account first.
  if (run === null) starting.begin(account.id)

  const environment: Record<string, string> = {}
  try {
    const login = store.githubLoginOf(session.profileId)
    if (login !== null) {
      const token = await github.tokenOf(login)
      if (token.ok) environment.GH_TOKEN = token.value
      else {
        transcript.addEntry(session.id, notice('info', `Aether could not read the GitHub token of @${login}. The agent starts without it.`, 'github-token'))
      }
    }
  } catch (cause) {
    if (run === null) starting.end(account.id)
    throw cause
  }

  return {
    input: {
      mainDirectory: session.sourcePath,
      // The folder attachments outside the session folder. Story S6 asks the directory question before the start.
      additionalDirectories: additionalDirectoriesOf(session),
      model: session.model,
      mode: session.mode,
      sharedItems: [],
      settings: account.settings,
      environment,
      resume: run?.externalId ?? null
    },
    run,
    providerId: account.id
  }
}
