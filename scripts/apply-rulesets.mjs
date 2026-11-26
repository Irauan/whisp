// Applies the repository rulesets of .github/rulesets/ to GitHub with `gh api`.
//
//   node scripts/apply-rulesets.mjs --dry-run   prints each request and writes nothing
//   node scripts/apply-rulesets.mjs             applies the rulesets (the user approves each run)
//   --repo owner/name                           the target repository (default: the repo of the folder)
//
// The script is idempotent. It lists the rulesets of the repository, then updates the one with
// the same name (PUT) or creates it (POST). A second run changes nothing.
//
// Rulesets express the merge methods of each branch. So the script does not change the
// repository merge options. It only warns when a method that a ruleset allows is disabled in
// the repository, because the ruleset cannot switch it on.
//
// The dry run reads from GitHub (the list and the repository options) and sends no write.
// When a read fails, the dry run says so and plans a create for each ruleset.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const RULESETS_DIR = join(ROOT, '.github/rulesets')
export const RULESET_FILES = ['main.json', 'milestone.json']

const DEFAULT_REPO = '{owner}/{repo}'
const API_VERSION = 'X-GitHub-Api-Version: 2022-11-28'
// The repository option that must stay on for each merge method of a ruleset.
const MERGE_OPTION = {
  merge: 'allow_merge_commit',
  squash: 'allow_squash_merge',
  rebase: 'allow_rebase_merge'
}

/**
 * Reads the options of the command line.
 * @param {string[]} argv
 * @returns {{ dryRun: boolean, repo: string }}
 */
export function parseArgs(argv) {
  const options = { dryRun: false, repo: DEFAULT_REPO }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--repo') {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) throw new Error('--repo needs a value, like owner/name.')
      options.repo = value
      i += 1
    } else throw new Error(`Unknown option: ${arg}`)
  }
  return options
}

/**
 * Reads the ruleset files.
 * @param {string} [dir]
 * @returns {{ file: string, name: string, body: any }[]}
 */
export function readRulesets(dir = RULESETS_DIR) {
  return RULESET_FILES.map((file) => {
    const body = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    if (typeof body.name !== 'string' || body.name === '') {
      throw new Error(`${file} has no name.`)
    }
    return { file, name: body.name, body }
  })
}

/**
 * Builds the request that creates a ruleset, or updates it when its id is known.
 * @param {string} repo
 * @param {{ name: string, body: any }} ruleset
 * @param {number | undefined} id
 */
export function buildRequest(repo, ruleset, id) {
  const base = `repos/${repo}/rulesets`
  return id === undefined
    ? { action: 'create', method: 'POST', endpoint: base, name: ruleset.name, body: ruleset.body }
    : { action: 'update', method: 'PUT', endpoint: `${base}/${id}`, name: ruleset.name, body: ruleset.body }
}

/**
 * Plans one request for each ruleset: an update by name, or a create.
 * @param {string} repo
 * @param {{ name: string, body: any }[]} rulesets
 * @param {{ id: number, name: string }[]} existing The rulesets that GitHub lists.
 */
export function planRequests(repo, rulesets, existing) {
  return rulesets.map((ruleset) => {
    const same = existing.filter((item) => item.name === ruleset.name)
    if (same.length > 1) {
      throw new Error(`GitHub lists ${same.length} rulesets named "${ruleset.name}". Remove the extra ones first.`)
    }
    return buildRequest(repo, ruleset, same[0]?.id)
  })
}

/**
 * Runs `gh`. The real runner. Tests give a fake one.
 * @param {string[]} args
 * @param {string} [input] Text for stdin.
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
export function runGh(args, input) {
  const run = spawnSync('gh', args, { input, encoding: 'utf8', cwd: ROOT })
  if (run.error) return { status: 1, stdout: '', stderr: String(run.error.message) }
  return { status: run.status ?? 1, stdout: run.stdout, stderr: run.stderr }
}

const readCall = (endpoint) => ['api', '-H', API_VERSION, endpoint]
const writeCall = (request) => [
  'api',
  '--method',
  request.method,
  '-H',
  API_VERSION,
  request.endpoint,
  '--input',
  '-'
]

const describeFailure = (run) => (run.stderr || run.stdout || `gh exited with ${run.status}`).trim()

/** Lists the repository rulesets. Throws on a failed call. */
function listRulesets(gh, repo) {
  const run = gh(readCall(`repos/${repo}/rulesets?per_page=100&includes_parents=false`))
  if (run.status !== 0) throw new Error(describeFailure(run))
  const list = JSON.parse(run.stdout || '[]')
  if (!Array.isArray(list)) throw new Error('GitHub gave a ruleset list that is not an array.')
  return list
}

/** Returns the warnings about merge options that the repository disables. */
function mergeOptionWarnings(gh, repo, rulesets) {
  const run = gh(readCall(`repos/${repo}`))
  if (run.status !== 0) return [`Cannot read the repository merge options: ${describeFailure(run)}`]
  const options = JSON.parse(run.stdout || '{}')
  const methods = new Set(
    rulesets.flatMap((ruleset) =>
      (ruleset.body.rules ?? [])
        .filter((rule) => rule.type === 'pull_request')
        .flatMap((rule) => rule.parameters?.allowed_merge_methods ?? [])
    )
  )
  return [...methods]
    .filter((method) => MERGE_OPTION[method] && options[MERGE_OPTION[method]] === false)
    .map(
      (method) =>
        `Warning: the repository has ${MERGE_OPTION[method]} set to false, so a ruleset that allows "${method}" cannot merge.`
    )
}

/**
 * Applies the rulesets, or prints the requests in a dry run.
 * @param {{ argv: string[], gh?: typeof runGh, rulesets?: ReturnType<typeof readRulesets>, log?: (line: string) => void, error?: (line: string) => void }} io
 * @returns {number} The exit status: 0 done, 1 a call or a plan failed, 2 a bad option.
 */
export function applyRulesets({
  argv,
  gh = runGh,
  rulesets = readRulesets(),
  log = console.log,
  error = console.error
}) {
  let options
  try {
    options = parseArgs(argv)
  } catch (cause) {
    error(`apply-rulesets: ${cause.message}`)
    return 2
  }
  const { dryRun, repo } = options
  if (dryRun) log('Dry run: the script sends no write. It reads the rulesets and the repository options.')

  for (const warning of mergeOptionWarnings(gh, repo, rulesets)) log(warning)

  let existing = []
  try {
    existing = listRulesets(gh, repo)
  } catch (cause) {
    if (!dryRun) {
      error(`apply-rulesets: cannot list the rulesets: ${cause.message}`)
      return 1
    }
    log(`Cannot list the rulesets (${cause.message}). The dry run plans a create for each file.`)
  }

  let plan
  try {
    plan = planRequests(repo, rulesets, existing)
  } catch (cause) {
    error(`apply-rulesets: ${cause.message}`)
    return 1
  }

  for (const request of plan) {
    const payload = JSON.stringify(request.body, null, 2)
    if (dryRun) {
      log(`\n${request.action} "${request.name}":`)
      log(`${request.method} ${request.endpoint}`)
      log(payload)
      continue
    }
    const run = gh(writeCall(request), payload)
    if (run.status !== 0) {
      error(`apply-rulesets: ${request.action} of "${request.name}" failed: ${describeFailure(run)}`)
      return 1
    }
    log(`${request.action}: "${request.name}" done (${request.method} ${request.endpoint}).`)
  }
  if (dryRun) log('\nDry run done. Nothing changed on GitHub.')
  return 0
}

function main() {
  process.exitCode = applyRulesets({ argv: process.argv.slice(2) })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
