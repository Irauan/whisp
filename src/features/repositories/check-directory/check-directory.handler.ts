import { basename, relative, sep } from 'node:path'
import type { Clock } from '../../../building-blocks/clock.port'
import { isInside, isUnc, pathKey, repositoryRootOf, resolveReal } from '../../../building-blocks/paths'
import {
  hasFindings,
  mergeFindings,
  noFindings,
  prefixFindings,
  type ProjectFindings,
  type ProjectScanner
} from '../../../building-blocks/project-scanner.port'
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
 * Where a folder lies, for a profile. The most specific workspace directory that holds the folder
 * decides (user decision, 2026-11-27): with A at `X` and B at `X\client`, a folder in `X\client`
 * belongs to B, also for a session of A. Two profiles that share a directory tie, and the profile
 * that asks wins. A profile without a workspace directory holds nothing. A folder that no workspace
 * directory holds is outside. The keys come from `pathKey`.
 */
export function placementOf(folderKey: string, own: ProfileFacts | null, others: readonly ProfileFacts[]): Placement {
  let best: { profile: ProfileFacts; length: number; own: boolean } | null = null
  for (const [profile, isOwn] of [[own, true], ...others.map((other) => [other, false] as const)] as const) {
    if (!profile?.workspaceDirectory) continue
    const directory = pathKey(profile.workspaceDirectory)
    if (!isInside(folderKey, directory)) continue
    if (best === null || directory.length > best.length) best = { profile, length: directory.length, own: isOwn }
  }
  if (best === null) return { kind: 'outside' }
  return best.own ? { kind: 'inside' } : { kind: 'other-profile', profile: best.profile }
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
 * - A folder in the most specific workspace directory, when it is the directory of the profile: a Git
 *   repository always asks for trust. A plain folder asks when the scan finds a settings file, an
 *   `.mcp.json`, a hook or a server. Trust covers the whole repository and stays for the profile.
 *   A plain folder without findings asks nothing.
 * - A folder outside every workspace directory, or in the directory of another profile: the
 *   directory question, which also lists what Aether finds. No second question follows.
 * No agent process exists and no file of the folder runs before the answer. Aether reads the files
 * that the scanner names and runs no `git` process in the folder. A cancel during the scan opens no question.
 */
export async function checkDirectoryHandler(deps: CheckDirectoryDeps, request: DirectoryRequest): Promise<DirectoryCheck> {
  const { store } = deps
  // Taken before any wait. A stop, a delete or a quit during the scan then opens no question.
  const mark = deps.questions.mark(request.sessionId)
  const profile = store.profile(request.profileId)
  const folder = resolveReal(request.folder)
  const key = pathKey(folder)
  const placement = placementOf(key, profile, store.otherProfiles(request.profileId))
  const profileName = profile?.name ?? ''

  if (placement.kind === 'inside') {
    return trustQuestion(deps, request, { folder, profileName, mark, workspaceDirectory: profile?.workspaceDirectory ?? null })
  }
  if (store.isAllowed(request.profileId, request.sessionId, key)) return allowed
  return directoryQuestion(deps, request, { folder, key, profileName, placement, mark })
}

/**
 * True when the repository root holds the workspace directory of the profile: the root is that directory,
 * or the directory lies inside the root (user decision, 2026-11-27). Trust of such a repository covers every
 * plain folder under the workspace directory, so the question warns. The keys come from `pathKey`.
 */
export function holdsWorkspace(root: string | null, workspaceDirectory: string | null): boolean {
  if (root === null || workspaceDirectory === null) return false
  return isInside(pathKey(workspaceDirectory), pathKey(root))
}

async function trustQuestion(
  deps: CheckDirectoryDeps,
  request: DirectoryRequest,
  { folder, profileName, mark, workspaceDirectory }: { folder: string; profileName: string; mark: string; workspaceDirectory: string | null }
): Promise<DirectoryCheck> {
  const { store, questions } = deps
  // The walk goes up past the workspace directory (user decision, 2026-11-27): trust covers the repository.
  const root = repositoryRootOf(folder)
  const findings = await findingsOf(deps, folder, root)
  // A repository always asks. A plain folder asks when it has a settings file or `.mcp.json`.
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
    repositoryRoot: root,
    holdsWorkspace: holdsWorkspace(root, workspaceDirectory),
    workspaceDirectory,
    ...findings
  }, mark)
  if (answer !== 'trust') return err(REFUSALS.trust.code, REFUSALS.trust.message)
  store.trust(request.profileId, trustedKey, deps.clock.now().toISOString())
  return allowed
}

async function directoryQuestion(
  deps: CheckDirectoryDeps,
  request: DirectoryRequest,
  {
    folder,
    key,
    profileName,
    placement,
    mark
  }: { folder: string; key: string; profileName: string; placement: Exclude<Placement, { kind: 'inside' }>; mark: string }
): Promise<DirectoryCheck> {
  const { store, questions } = deps
  // A network folder is not read before the answer: the read could wait for ever, and the question says so.
  const findings = isUnc(folder)
    ? { ...noFindings(), unreadable: ['this network folder'] }
    : await findingsOf(deps, folder, repositoryRootOf(folder))
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

  const answer = await questions.ask(question, mark)
  if (answer === 'allow-once') store.allowOnce(request.sessionId, key)
  else if (answer === 'allow-always') store.allowAlways(request.profileId, key, deps.clock.now().toISOString())
  else return err(REFUSALS.directory.code, REFUSALS.directory.message)
  return allowed
}

/**
 * What the agent reads in the session folder, and in the root of its repository when the folder lies
 * inside one. The names of the files of the folder carry its path from the root, so two files with
 * one name stay apart.
 */
async function findingsOf(deps: CheckDirectoryDeps, folder: string, root: string | null): Promise<ProjectFindings> {
  const here = await deps.scanner.scan(folder)
  if (root === null || root === folder) return here
  const inside = prefixFindings(here, `${relative(root, folder)}${sep}`)
  return mergeFindings(await deps.scanner.scan(root), inside)
}
