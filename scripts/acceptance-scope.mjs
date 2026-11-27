// The acceptance scope: picks the acceptance specs to run, then builds the app and runs Playwright.
//
// User decision, 2026-11-27: a story runs only the scenarios that it touches. The full suite runs
// once all stories are merged to the milestone branch (milestone validation), and on `main`.
//
// Story run (`--base <ref>`): the spec folders `tests/acceptance/<milestone>/<story>/` that the
// change between <ref> and HEAD touches, and the folder of the story branch. The branch
// `story/m1-s5-permission-queue` gives `tests/acceptance/m1-*/s5/`. With no folder, nothing runs
// and the job passes.
//
// Full run (`--all`): every spec under `tests/acceptance/`.
//
// `--list` prints the selection and runs nothing.
//
// The CI job runs the copy of this file from the base branch, so a PR cannot narrow the run that
// judges it. So this file imports Node modules only.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'

const ACCEPTANCE = 'tests/acceptance'
const NULL_SHA = /^0+$/

function parseArgs(argv) {
  const args = { all: false, list: false, base: undefined, branch: undefined }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--all') args.all = true
    else if (arg === '--list') args.list = true
    else if (arg === '--base') args.base = argv[++i]
    else if (arg === '--branch') args.branch = argv[++i]
    else throw new Error(`acceptance-scope: unknown argument ${arg}`)
  }
  return args
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function currentBranch() {
  try {
    return git('rev-parse', '--abbrev-ref', 'HEAD')
  } catch {
    return ''
  }
}

// Returns the folder `tests/acceptance/<milestone>/<story>` of a path, or undefined.
function storyFolder(path) {
  const match = /^tests\/acceptance\/([^/]+)\/([^/]+)\//.exec(path)
  return match ? `${ACCEPTANCE}/${match[1]}/${match[2]}` : undefined
}

// `story/m1-s5-permission-queue` gives the folders `tests/acceptance/m1-*/s5` that exist.
function branchFolders(branch) {
  const match = /^story\/(m\d+)-(s\d+)(?:-|$)/.exec(branch ?? '')
  if (!match || !existsSync(ACCEPTANCE)) return []
  const [, milestone, story] = match
  return readdirSync(ACCEPTANCE, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${milestone}-`))
    .map((entry) => `${ACCEPTANCE}/${entry.name}/${story}`)
    .filter((folder) => existsSync(folder))
}

function select(args) {
  if (args.all) return { all: true, folders: [] }
  if (!args.base || NULL_SHA.test(args.base)) {
    console.log('acceptance-scope: no base to compare with, so the full suite runs')
    return { all: true, folders: [] }
  }
  const changed = git('diff', '--name-only', `${args.base}...HEAD`).split('\n').filter(Boolean)
  const folders = new Set(changed.map(storyFolder).filter(Boolean))
  for (const folder of branchFolders(args.branch ?? currentBranch())) folders.add(folder)
  return { all: false, folders: [...folders].filter((folder) => existsSync(folder)).sort() }
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit', shell: true })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const args = parseArgs(process.argv.slice(2))
const selection = select(args)

if (selection.all) console.log('acceptance-scope: full suite')
else if (selection.folders.length === 0) console.log('acceptance-scope: the change touches no acceptance scenario')
else console.log(`acceptance-scope: ${selection.folders.join(', ')}`)

if (args.list || (!selection.all && selection.folders.length === 0)) process.exit(0)

run('npm', ['run', 'build'])
// Playwright reads each argument as a filter on the file path.
run('npx', ['playwright', 'test', ...selection.folders])
