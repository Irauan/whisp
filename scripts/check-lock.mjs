// The test lock: checks that a story does not change a locked test.
//
// tests/locks.json maps each locked file to its SHA-256 and its story:
//   { "tests/acceptance/m0-gates/s5/app.spec.ts": { "sha256": "<hex>", "story": "m0-gates/s5" } }
//
// Hash rule: the hash covers the content of the file with each CRLF turned into LF. A Windows
// checkout can convert line endings, and the hash must not depend on that. The check reads the
// files from git objects at the head, so it does not read the working tree. The rule is for
// text files.
//
// Pull request check (`--base <ref>`). When the base is a milestone branch, the PR is a story
// PR and the check walks its commits. When the base is another branch (`main`), the PR is a
// milestone PR with squashed stories: the check then runs only the hash check and the known
// violations rule against the fork point.
//
// The CI job runs the copy of this file from the base branch, so a PR cannot weaken the check
// that judges it. So this file imports Node modules only, and it takes the repository with `--repo`.
//
// The story walk goes through the commits of base..head, oldest first.
// - The first commit that changes a file outside `tests/` is the first code commit.
// - Before it, a commit can add locked files and their entries.
// - From it on (the commit itself included), no commit can change a locked file or its entry.
// - A file that is locked on the base branch changes only in a commit with the trailer
//   `Locked-Test-Change: <reason>`, at any time. The check prints each reason.
// - After the first code commit, a file that the story locked changes only with the trailer.
//   The test author uses it for a test that the builder disputes.
// - The known violations of the head must not exceed the ones of the fork point, and no
//   commit after the first code commit raises them.
// - At the head, each hash in tests/locks.json must match its file, and each file under
//   tests/acceptance/ and tests/simulated-agent/ must have an entry. Two such files whose
//   names differ only in case fail.
//
// Merge commits: a story can merge its milestone branch. A merge commit changes a file only
// when the merged content equals the content of no parent. A file that arrives from the base
// branch, or that one parent already had, is not a story change. The same rule applies to the
// entries of tests/locks.json and to the known violations. A change that only the merge makes,
// as in a conflict resolution, counts as a change of the story.
//
// Push check (no `--base`): checks the hashes at the head, and the known violations against
// the first parent of the head.
//
// `--add <story> <file>...` writes the entries of the files into tests/locks.json.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const LOCKS_FILE = 'tests/locks.json'
export const KNOWN_FILE = 'tests/architecture/known-violations.json'
export const TRAILER = 'Locked-Test-Change'
// A locked file lives under one of these folders, or it is tests/locks.json itself.
const LOCKED_FOLDERS = ['tests/acceptance/', 'tests/simulated-agent/']

/** Turns each CRLF into LF. */
export function normalizeLineEndings(buffer) {
  const out = Buffer.allocUnsafe(buffer.length)
  let length = 0
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0x0d && buffer[i + 1] === 0x0a) continue
    out[length++] = buffer[i]
  }
  return out.subarray(0, length)
}

/** The SHA-256 of a file content, as the lock defines it. */
export const hashContent = (buffer) =>
  createHash('sha256').update(normalizeLineEndings(buffer)).digest('hex')

const entryText = (file) => `\`${file}\``
const lockedChanged = (file, detail = '') =>
  `Locked test changed: ${entryText(file)}${detail ? ` (${detail})` : ''}`
const growthText = (rule, file, detail = '') =>
  `Known violations grew: ${entryText(rule)} in ${entryText(file)}${detail ? ` (${detail})` : ''}`

class Git {
  constructor(repo) {
    this.repo = repo
    this.entryCache = new Map()
    this.knownCache = new Map()
  }

  /** Runs git and returns the output as a buffer, or throws. */
  raw(args, { allowFailure = false } = {}) {
    const env = { ...process.env }
    for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[name]
    const run = spawnSync('git', ['-C', this.repo, ...args], { env, maxBuffer: 1 << 28 })
    if (run.error) throw new Error(`git did not start: ${run.error.message}`)
    if (run.status !== 0) {
      if (allowFailure) return null
      throw new Error(`git ${args.join(' ')} failed with status ${run.status}.\n${run.stderr}`)
    }
    return run.stdout
  }

  text(args, options) {
    return this.raw(args, options)?.toString('utf8') ?? null
  }

  /** The commit id of a reference, or null when it does not exist. */
  resolve(ref) {
    const out = this.text(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { allowFailure: true })
    return out === null ? null : out.trim()
  }

  /** The content of a file in a commit, or null when the commit has no such file. */
  blob(commit, path) {
    return this.raw(['cat-file', 'blob', `${commit}:${path}`], { allowFailure: true })
  }

  /** The tests/locks.json of a commit: { entries, error }. */
  locks(commit) {
    if (!this.entryCache.has(commit)) this.entryCache.set(commit, this.#readLocks(commit))
    return this.entryCache.get(commit)
  }

  #readLocks(commit) {
    const raw = this.blob(commit, LOCKS_FILE)
    if (raw === null) return { entries: {}, error: null }
    let data
    try {
      data = JSON.parse(raw.toString('utf8'))
    } catch (error) {
      return { entries: {}, error: `${LOCKS_FILE} is not valid JSON: ${error.message}` }
    }
    const isObject = data !== null && typeof data === 'object' && !Array.isArray(data)
    if (!isObject) return { entries: {}, error: `${LOCKS_FILE} must hold an object of files` }
    for (const [file, entry] of Object.entries(data)) {
      const valid =
        entry !== null &&
        typeof entry === 'object' &&
        typeof entry.sha256 === 'string' &&
        /^[0-9a-f]{64}$/.test(entry.sha256) &&
        typeof entry.story === 'string' &&
        entry.story !== ''
      if (!valid) {
        return {
          entries: {},
          error: `${LOCKS_FILE} has an invalid entry for ${file}: it needs a sha256 (64 hex digits) and a story`
        }
      }
    }
    return { entries: data, error: null }
  }

  /** The known violations of a commit as a map from "rule\0file" to count, or null without the file. */
  known(commit) {
    if (!this.knownCache.has(commit)) this.knownCache.set(commit, this.#readKnown(commit))
    return this.knownCache.get(commit)
  }

  #readKnown(commit) {
    const raw = this.blob(commit, KNOWN_FILE)
    if (raw === null) return { list: null, error: null }
    let data
    try {
      data = JSON.parse(raw.toString('utf8'))
    } catch (error) {
      return { list: null, error: `${KNOWN_FILE} is not valid JSON: ${error.message}` }
    }
    if (!Array.isArray(data)) return { list: null, error: `${KNOWN_FILE} must hold an array` }
    const list = new Map()
    for (const entry of data) {
      if (typeof entry?.rule !== 'string' || typeof entry?.file !== 'string' || !Number.isInteger(entry?.count)) {
        return { list: null, error: `${KNOWN_FILE} has an entry without a rule, a file and a count` }
      }
      const key = `${entry.rule}\0${entry.file}`
      list.set(key, (list.get(key) ?? 0) + entry.count)
    }
    return { list, error: null }
  }

  /** The paths that a commit changes. A merge commit keeps only the paths that differ from every parent. */
  changedPaths(commit, parents) {
    const split = (out) => out.split('\0').filter(Boolean)
    if (parents.length === 0) {
      return new Set(split(this.text(['diff-tree', '-r', '--root', '--no-commit-id', '--no-renames', '--name-only', '-z', commit])))
    }
    let paths = null
    for (const parent of parents) {
      const these = new Set(split(this.text(['diff-tree', '-r', '--no-renames', '--name-only', '-z', parent, commit])))
      paths = paths === null ? these : new Set([...paths].filter((path) => these.has(path)))
    }
    return paths
  }

  /** The reason of the trailer `Locked-Test-Change` of a commit, or an empty string. */
  reason(commit) {
    const out = this.text(['log', '-1', `--format=%(trailers:key=${TRAILER},valueonly,unfold)`, commit])
    return out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('; ')
  }

  /** The files under the locked folders at a commit. */
  lockedFolderFiles(commit) {
    const out = this.text(['ls-tree', '-r', '--name-only', '-z', commit, '--', ...LOCKED_FOLDERS.map((f) => f.slice(0, -1))])
    return out.split('\0').filter(Boolean)
  }
}

const sameEntry = (a, b) => a?.sha256 === b?.sha256 && a?.story === b?.story

/** The files whose entry differs from the entry of every old map. */
function changedEntryFiles(oldMaps, newMap) {
  const files = new Set([...Object.keys(newMap), ...oldMaps.flatMap((old) => Object.keys(old))])
  return [...files].filter((file) => oldMaps.every((old) => !sameEntry(old[file], newMap[file])))
}

/** The known violations that exceed the count of every old list. Old lists that are null are skipped. */
function grownViolations(oldLists, newList) {
  if (newList === null || oldLists.length === 0 || oldLists.some((old) => old === null)) return []
  const grown = []
  for (const [key, count] of newList) {
    if (oldLists.every((old) => count > (old.get(key) ?? 0))) {
      const [rule, file] = key.split('\0')
      grown.push({ rule, file, count, listed: Math.max(...oldLists.map((old) => old.get(key) ?? 0)) })
    }
  }
  return grown
}

/** The hashes at the head, and the entries of tests/locks.json. */
function checkHashes(git, head, problems) {
  const { entries, error } = git.locks(head)
  if (error) {
    problems.add(error)
    return
  }
  for (const [file, entry] of Object.entries(entries)) {
    const content = git.blob(head, file)
    if (content === null) {
      problems.add(lockedChanged(file, 'the file is missing, so remove its entry with a commit that has the trailer'))
    } else if (hashContent(content) !== entry.sha256) {
      problems.add(lockedChanged(file, `the hash in ${LOCKS_FILE} is stale`))
    }
  }
  const files = git.lockedFolderFiles(head)
  for (const file of files) {
    if (!(file in entries)) problems.add(lockedChanged(file, `it has no entry in ${LOCKS_FILE}`))
  }
  // Windows and macOS hold one of two names that differ only in case. A checkout there would
  // read one file for two entries, and a lock could cover the wrong one.
  const byLowerCase = new Map()
  for (const file of files) {
    const key = file.toLowerCase()
    byLowerCase.set(key, [...(byLowerCase.get(key) ?? []), file])
  }
  for (const same of byLowerCase.values()) {
    if (same.length < 2) continue
    for (const file of same) {
      problems.add(lockedChanged(file, `it differs only in case from ${same.filter((other) => other !== file).join(', ')}`))
    }
  }
}

/**
 * A story PR targets a milestone branch. Its commits are the ones of the story, so the check
 * walks them. A milestone PR targets `main` and holds squashed stories: each commit has the
 * tests and the code of one story, so a walk would count each new entry as a change after code.
 */
export const isStoryBase = (base) =>
  /^milestone\//.test(base.replace(/^refs\/(remotes\/origin|heads)\//, '').replace(/^origin\//, ''))

function checkKnownGrowth(git, from, head, problems, where) {
  const before = git.known(from)
  const after = git.known(head)
  if (after.error) problems.add(after.error)
  if (before.list === null || after.list === null) return
  for (const { rule, file, count, listed } of grownViolations([before.list], after.list)) {
    problems.add(growthText(rule, file, `${count} now, ${listed} listed ${where}`))
  }
}

/**
 * Checks a pull request, or a push when `base` is not set.
 * @param {{ repo?: string, base?: string, head?: string }} options
 * @returns {{ problems: string[], approvals: string[] }}
 */
export function checkLock({ repo = ROOT, base, head = 'HEAD' } = {}) {
  const git = new Git(repo)
  const headSha = git.resolve(head)
  if (headSha === null) throw new Error(`The head does not exist: ${head}`)
  const problems = new Set()
  const approvals = []

  if (base === undefined) {
    checkHashes(git, headSha, problems)
    const previous = git.resolve(`${headSha}^1`)
    if (previous !== null) checkKnownGrowth(git, previous, headSha, problems, 'on the previous commit')
    return { problems: [...problems], approvals }
  }

  const baseSha = git.resolve(base)
  if (baseSha === null) {
    throw new Error(`The base does not exist: ${base}. Fetch it, for example with "git fetch origin".`)
  }
  const forkPoint = git.text(['merge-base', baseSha, headSha], { allowFailure: true })?.trim()
  if (!forkPoint) throw new Error(`The head ${head} and the base ${base} share no history.`)

  if (!isStoryBase(base)) {
    checkKnownGrowth(git, forkPoint, headSha, problems, 'at the fork point')
    checkHashes(git, headSha, problems)
    return { problems: [...problems], approvals }
  }

  const baseLocks = git.locks(baseSha).entries
  const lines = git
    .text(['rev-list', '--reverse', '--topo-order', '--parents', `${baseSha}..${headSha}`])
    .split('\n')
    .filter(Boolean)
  let codeStarted = false

  for (const line of lines) {
    const [commit, ...parents] = line.split(' ')
    const short = commit.slice(0, 7)
    const paths = git.changedPaths(commit, parents)
    const isCode = [...paths].some((path) => !path.startsWith('tests/'))
    const active = codeStarted || isCode
    codeStarted = active

    const before = parents.length === 0 ? [{}] : parents.map((parent) => git.locks(parent).entries)
    const touched = new Set()
    for (const path of paths) {
      if (path === LOCKS_FILE) continue
      if (path in baseLocks || (active && before.some((entries) => path in entries))) touched.add(path)
    }
    if (paths.has(LOCKS_FILE)) {
      for (const file of changedEntryFiles(before, git.locks(commit).entries)) {
        if (file in baseLocks || active) touched.add(file)
      }
    }
    if (touched.size > 0) {
      const reason = git.reason(commit)
      for (const file of [...touched].sort()) {
        if (reason) approvals.push(`Locked test change approved: ${entryText(file)} in ${short}: ${reason}`)
        else problems.add(lockedChanged(file, `commit ${short} has no ${TRAILER} trailer with a reason`))
      }
    }

    if (active && paths.has(KNOWN_FILE)) {
      const oldLists = parents.map((parent) => git.known(parent).list)
      for (const { rule, file, count, listed } of grownViolations(oldLists, git.known(commit).list)) {
        problems.add(growthText(rule, file, `commit ${short} has ${count}, the parent has ${listed}`))
      }
    }
  }

  checkKnownGrowth(git, forkPoint, headSha, problems, 'at the fork point')
  checkHashes(git, headSha, problems)
  return { problems: [...problems], approvals }
}

/** Adds the entries of the files to tests/locks.json in the working tree. */
export function addEntries({ repo = ROOT, story, files }) {
  if (!story) throw new Error('--add needs a story, for example "m0-gates/s6".')
  if (files.length === 0) throw new Error('--add needs at least one file.')
  const path = resolve(repo, LOCKS_FILE)
  let entries = {}
  try {
    entries = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`${LOCKS_FILE} is not valid JSON: ${error.message}`)
  }
  for (const file of files) {
    const name = relative(repo, resolve(repo, file)).replaceAll('\\', '/')
    if (name.startsWith('..')) throw new Error(`The file is outside the repository: ${file}`)
    entries[name] = { sha256: hashContent(readFileSync(resolve(repo, name))), story }
  }
  const sorted = Object.fromEntries(Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`)
  return files.length
}

function parseArgs(args) {
  const options = {}
  for (let i = 0; i < args.length; i++) {
    const name = args[i]
    if (name === '--add') {
      options.story = args[++i]
      options.files = []
      while (i + 1 < args.length && !args[i + 1].startsWith('--')) options.files.push(args[++i])
      options.add = true
    } else if (name === '--repo' || name === '--base' || name === '--head') {
      if (args[i + 1] === undefined) throw new Error(`${name} needs a value.`)
      options[name.slice(2)] = args[++i]
    } else {
      throw new Error(`Unknown argument: ${name}`)
    }
  }
  if (options.repo) options.repo = resolve(options.repo)
  return options
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.add) {
      const count = addEntries(options)
      console.log(`lock: added ${count} ${count === 1 ? 'entry' : 'entries'} to ${LOCKS_FILE}`)
      return
    }
    const { problems, approvals } = checkLock(options)
    for (const approval of approvals) console.log(approval)
    if (problems.length === 0) {
      console.log('lock: passed')
      return
    }
    console.error('lock: FAILED')
    for (const problem of problems) console.error(problem)
    process.exitCode = 1
  } catch (error) {
    console.error('lock: FAILED')
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
