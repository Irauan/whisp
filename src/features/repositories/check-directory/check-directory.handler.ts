import { basename } from 'node:path'
import type { Clock } from '../../../building-blocks/clock.port'
import { isInside, pathKey, repositoryRootOf, resolveReal } from '../../../building-blocks/paths'
import { hasFindings, mergeFindings, type ProjectFindings, type ProjectScanner } from '../../../building-blocks/project-scanner.port'
import { err, ok, type Result } from '../../../building-blocks/result'
import { REFUSALS, type NewQuestion } from '../question'
import type { Questions } from '../questions.store'
import type { ProfileFacts, TrustStore } from '../trust.store'

export interface CheckDirectoryDeps {
  store: TrustStore
  questions: Questions
  scanner: ProjectScanner
  clock: Clock
}

/** The folder that a session wants to use, and the profile that asks. The main process reads both from the saved session. */
export interface DirectoryRequest {
  sessionId: string
  profileId: string
  folder: string
}

export type Placement =
  | { kind: 'inside' }
  | { kind: 'outside' }
  | { kind: 'other-profile'; profile: ProfileFacts }

/**
 * Where a folder lies, for a profile. The order decides: the workspace directory of the profile
 * first, then the workspace directory of another profile, else outside. A profile without a
 * workspace directory has everything outside. Two profiles can share a directory: the profile that
 * asks wins. The keys come from `pathKey`.
 */
export function placementOf(folderKey: string, own: ProfileFacts | null, others: readonly ProfileFacts[]): Placement {
  const ownKey = own?.workspaceDirectory ? pathKey(own.workspaceDirectory) : null
  if (ownKey !== null && isInside(folderKey, ownKey)) return { kind: 'inside' }
  for (const other of others) {
    if (other.workspaceDirectory && isInside(folderKey, pathKey(other.workspaceDirectory))) return { kind: 'other-profile', profile: other }
  }
  return { kind: 'outside' }
}

/**
 * The answer of the gate. `error.code` and `error.message` make the notice of the session when the
 * user refuses. A wake-up (Stop, delete, quit) also gives an error: the turn then tells it apart.
 */
export type DirectoryCheck = Result<Record<string, never>, string>

const allowed: DirectoryCheck = ok({})

/**
 * The gate before an agent process starts, also before a resume (architecture, Directories and
 * trust; decision 0007). It decides which question applies and waits for the answer.
 * - A folder under the workspace directory of the profile: a Git repository, or a plain folder with
 *   a `SessionStart` hook or an MCP server, asks for trust once. Trust covers the whole repository.
 *   A plain folder without them asks nothing.
 * - A folder outside it, or under the workspace directory of another profile: the directory
 *   question, which also lists the hooks and MCP servers that Aether finds. No second question follows.
 * No agent process exists and no file of the folder runs before the answer. Aether reads two files
 * and runs no `git` process in the folder.
 */
export async function checkDirectoryHandler(deps: CheckDirectoryDeps, request: DirectoryRequest): Promise<DirectoryCheck> {
  const { store } = deps
  const profile = store.profile(request.profileId)
  const folder = resolveReal(request.folder)
  const key = pathKey(folder)
  const placement = placementOf(key, profile, store.otherProfiles(request.profileId))
  const profileName = profile?.name ?? ''

  if (placement.kind === 'inside') {
    return trustQuestion(deps, request, { folder, profileName, workspaceKey: pathKey(profile?.workspaceDirectory ?? folder) })
  }
  if (store.isAllowed(request.profileId, request.sessionId, key)) return allowed
  return directoryQuestion(deps, request, { folder, key, profileName, placement })
}

async function trustQuestion(
  deps: CheckDirectoryDeps,
  request: DirectoryRequest,
  { folder, profileName, workspaceKey }: { folder: string; profileName: string; workspaceKey: string }
): Promise<DirectoryCheck> {
  const { store, questions, scanner } = deps
  const root = repositoryRootOf(folder, workspaceKey)
  const here = await scanner.scan(folder)
  const findings = root !== null && root !== folder ? mergeFindings(await scanner.scan(root), here) : here
  // A repository always asks. A plain folder asks only when it holds a hook or an MCP server.
  if (root === null && !hasFindings(findings)) return allowed
  const trusted = root ?? folder
  const trustedKey = pathKey(trusted)
  if (store.isTrusted(request.profileId, trustedKey)) return allowed

  const answer = await questions.ask({
    kind: 'trust',
    sessionId: request.sessionId,
    profileName,
    folder: request.folder,
    repository: basename(trusted),
    ...findings
  })
  if (answer !== 'trust') return err(REFUSALS.trust.code, REFUSALS.trust.message)
  store.trust(request.profileId, trustedKey, deps.clock.now().toISOString())
  return allowed
}

async function directoryQuestion(
  deps: CheckDirectoryDeps,
  request: DirectoryRequest,
  { folder, key, profileName, placement }: { folder: string; key: string; profileName: string; placement: Exclude<Placement, { kind: 'inside' }> }
): Promise<DirectoryCheck> {
  const { store, questions } = deps
  const findings = await findingsOutside(deps, folder)
  const base = { sessionId: request.sessionId, profileName, folder: request.folder, ...findings }
  const question: NewQuestion =
    placement.kind === 'other-profile'
      ? {
          kind: 'other-profile',
          ...base,
          otherProfileName: placement.profile.name,
          claudeFolder: store.claudeFolderOf(request.sessionId, request.profileId)
        }
      : { kind: 'outside', ...base }

  const answer = await questions.ask(question)
  if (answer === 'allow-once') store.allowOnce(request.sessionId, key)
  else if (answer === 'allow-always') store.allowAlways(request.profileId, key, deps.clock.now().toISOString())
  else return err(REFUSALS.directory.code, REFUSALS.directory.message)
  return allowed
}

/** What the agent would run in a folder outside the workspace directory: the folder, and its repository when it has one. */
async function findingsOutside(deps: CheckDirectoryDeps, folder: string): Promise<ProjectFindings> {
  const root = repositoryRootOf(folder)
  const here = await deps.scanner.scan(folder)
  return root !== null && root !== folder ? mergeFindings(await deps.scanner.scan(root), here) : here
}
