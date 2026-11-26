// The architecture gate: runs dependency-cruiser with the swc parser on `src`, then compares
// the violations with the import entries of tests/architecture/known-violations.json.
//
// The comparison is the one of the lint gate (scripts/lint-gate.mjs): the same
// { rule, file, count } entries and the same messages. An import entry names a rule of
// .dependency-cruiser.cjs, for example "no-slice-to-slice". The file is the importing file.
// This gate reads only the entries of those rules and keeps the others as they are.
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FIXTURES,
  ROOT,
  compareWithKnown,
  describeProblems,
  entryKey,
  isLintRule,
  readKnownViolations
} from './lint-gate.mjs'

export { FIXTURES, ROOT }

const require = createRequire(import.meta.url)
const DEPCRUISE_BIN = join(ROOT, 'node_modules/dependency-cruiser/bin/dependency-cruiser.mjs')
const CONFIG = join(ROOT, '.dependency-cruiser.cjs')
const SOURCE = /\.(ts|tsx|mts|cts)$/

/** The names of the rules in .dependency-cruiser.cjs. */
export const importRuleNames = () => require(CONFIG).forbidden.map((rule) => rule.name)

/**
 * Runs dependency-cruiser with the swc parser.
 * Without @swc/core, dependency-cruiser does not fail: it skips the TypeScript files and
 * reports no violation. So the caller checks the list of cruised modules.
 * @param {{ cwd?: string, targets?: string[] }} options `cwd` is the folder that holds `src`.
 * @returns {{ diagnostics: { rule: string, file: string, line: number, column: number, message: string }[], modules: string[] }}
 */
export function runDepcruise({ cwd = ROOT, targets = ['src'] } = {}) {
  const args = [DEPCRUISE_BIN, '-c', CONFIG, '-T', 'json', '--no-cache', ...targets]
  const run = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 })
  // The exit status is the number of violations, so only the report tells a crash.
  let report
  try {
    report = JSON.parse(run.stdout)
  } catch {
    throw new Error(
      `dependency-cruiser failed with status ${run.status}.\n${run.error ?? ''}${run.stdout}\n${run.stderr}`
    )
  }
  const diagnostics = report.summary.violations.map((v) => ({
    rule: v.rule.name,
    file: v.from,
    line: 0,
    column: 0,
    message: v.cycle
      ? `cycle ${[v.from, ...v.cycle.map((step) => step.name)].join(' -> ')}`
      : `${v.type === 'reachability' ? 'reaches' : 'imports'} ${v.to}`
  }))
  return { diagnostics, modules: report.modules.map((module) => module.source) }
}

function walk(folder, found = []) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) walk(path, found)
    else if (SOURCE.test(entry.name)) found.push(path)
  }
  return found
}

/** @returns {string[]} The source files under `<cwd>/src` that dependency-cruiser did not read. */
export function findUncruisedFiles(modules, cwd = ROOT) {
  const cruised = new Set(modules)
  return walk(join(cwd, 'src'))
    .map((file) => relative(cwd, file).replaceAll('\\', '/'))
    .filter((file) => !cruised.has(file))
    .sort()
}

/**
 * Fails when the swc parser does not run. The g-swc fixture has one type import.
 * The gate runs this check because a missing @swc/core gives a silent pass.
 */
export function assertSwcParserRuns() {
  const { modules, diagnostics } = runDepcruise({ cwd: join(ROOT, FIXTURES, 'g-swc') })
  const missing = findUncruisedFiles(modules, join(ROOT, FIXTURES, 'g-swc'))
  if (missing.length > 0 || diagnostics.length > 0) {
    throw new Error(
      'The swc parser did not run: dependency-cruiser did not read the TypeScript files of the g-swc fixture. Check that @swc/core is installed.'
    )
  }
}

/**
 * Compares the violations with the known import entries.
 * @returns {{ grew: object[], fewer: object[] }} The result of `compareWithKnown`.
 */
export function compareImports(diagnostics, known) {
  const names = new Set(importRuleNames())
  return compareWithKnown(diagnostics, known, (rule) => names.has(rule))
}

/**
 * Finds the entries whose rule no gate owns: neither a lint rule nor a rule of
 * .dependency-cruiser.cjs. Without this check a typo in a rule name leaves the entry unused.
 */
export function describeUnownedEntries(known) {
  const names = new Set(importRuleNames())
  return known
    .filter((entry) => !isLintRule(entry.rule) && !names.has(entry.rule))
    .map((entry) => `Known violation names no rule of a gate, fix or remove it: \`${entryKey(entry)}\``)
}

export { describeProblems }

function main() {
  try {
    run(process.argv.slice(2))
  } catch (error) {
    console.error('architecture: FAILED')
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

/**
 * `--root <folder>` and `--known <file>` point the gate at another tree and list.
 * The tests use them on the fixtures of G9. The defaults are the repository and its list.
 */
function parseArgs(args) {
  const options = {}
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === '--root' && args[i + 1]) options.cwd = resolve(args[i + 1])
    else if (args[i] === '--known' && args[i + 1]) options.known = resolve(args[i + 1])
    else throw new Error(`Unknown argument: ${args[i]}`)
  }
  return options
}

function run(args) {
  const { cwd = ROOT, known } = parseArgs(args)
  assertSwcParserRuns()
  const { diagnostics, modules } = runDepcruise({ cwd })
  const uncruised = findUncruisedFiles(modules, cwd)
  if (uncruised.length > 0) {
    throw new Error(`dependency-cruiser did not read these files:\n${uncruised.join('\n')}`)
  }
  const entries = readKnownViolations(known)
  const problems = [
    ...describeUnownedEntries(entries),
    ...describeProblems(compareImports(diagnostics, entries))
  ]
  if (problems.length === 0) {
    console.log('architecture: passed')
    return
  }
  console.error('architecture: FAILED')
  for (const problem of problems) console.error(problem)
  process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
