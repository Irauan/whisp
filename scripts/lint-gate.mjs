// The lint gate: runs oxlint with tsgolint, then compares the result with the
// lint entries of tests/architecture/known-violations.json.
//
// The list is a JSON array of { "rule": string, "file": string, "count": number }.
// A lint entry uses the oxlint code as its rule, for example "eslint(no-restricted-globals)".
// One entry covers one rule in one file. "count" is the number of occurrences it accepts.
// Entries of other tools (S3: imports) use a rule name without parentheses.
// This gate reads only the lint entries and keeps the others as they are.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const KNOWN_VIOLATIONS_FILE = join(ROOT, 'tests/architecture/known-violations.json')
export const FIXTURES = 'tests/architecture/fixtures'

const OXLINT_BIN = join(ROOT, 'node_modules/oxlint/bin/oxlint')
const LINT_RULE = /^[\w-]+\([\w/-]+\)$/

export const isLintRule = (rule) => LINT_RULE.test(rule)

export const entryKey = (entry) => `${entry.rule} in ${entry.file}`

/**
 * Runs oxlint with type-aware rules and returns its diagnostics.
 * @param {string[]} targets Paths to lint, relative to the repository root.
 * @param {{ ignoreFixtures?: boolean }} options
 * @returns {{ rule: string, file: string, line: number, column: number, message: string }[]}
 */
export function runOxlint(targets, { ignoreFixtures = true } = {}) {
  const args = [OXLINT_BIN, '-c', '.oxlintrc.json', '--type-aware', '--format', 'json']
  if (ignoreFixtures) args.push('--ignore-pattern', `${FIXTURES}/**`)
  else args.push('--no-ignore')
  args.push(...targets)
  const run = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' })
  // oxlint exits 0 without findings and 1 with errors. Any other status is a crash.
  if (run.error || (run.status !== 0 && run.status !== 1)) {
    throw new Error(
      `oxlint failed with status ${run.status}.\n${run.error ?? ''}${run.stdout}\n${run.stderr}`
    )
  }
  let report
  try {
    report = JSON.parse(run.stdout)
  } catch {
    throw new Error(`oxlint gave no JSON report.\n${run.stdout}\n${run.stderr}`)
  }
  if (run.status === 1 && report.diagnostics.length === 0) {
    throw new Error(`oxlint exited with 1 and reported no finding.\n${run.stderr}`)
  }
  return report.diagnostics.map((d) => {
    const span = d.labels?.[0]?.span ?? {}
    return {
      rule: d.code,
      file: relative(ROOT, resolve(ROOT, d.filename)).replaceAll('\\', '/'),
      line: span.line ?? 0,
      column: span.column ?? 0,
      message: d.message
    }
  })
}

export function readKnownViolations(file = KNOWN_VIOLATIONS_FILE) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/**
 * Compares the diagnostics of one tool with the known entries of that tool.
 * The architecture gate reuses this function with its own `owns` test.
 * @param {{ rule: string, file: string }[]} diagnostics
 * @param {{ rule: string, file: string, count?: number }[]} known All entries of the list.
 * @param {(rule: string) => boolean} owns Tells whether a rule belongs to the tool.
 * The default owns the lint rules.
 * @returns {{ grew: object[], fewer: object[] }} `grew` holds one item for each rule and
 * file with more occurrences than listed (an unlisted file has a limit of 0). `fewer`
 * holds the listed entries with fewer occurrences than their `count`.
 */
export function compareWithKnown(diagnostics, known, owns = isLintRule) {
  const lintEntries = known.filter((entry) => owns(entry.rule))
  for (const entry of lintEntries) {
    if (!Number.isInteger(entry.count) || entry.count < 1) {
      throw new Error(`Known violation has no valid count: ${entryKey(entry)}`)
    }
  }
  const listed = new Map(lintEntries.map((entry) => [entryKey(entry), entry]))
  const found = new Map()
  for (const d of diagnostics) {
    const item = found.get(entryKey(d)) ?? { first: d, count: 0 }
    item.count += 1
    found.set(entryKey(d), item)
  }
  const grew = []
  for (const [key, { first, count }] of found) {
    const limit = listed.get(key)?.count ?? 0
    if (count > limit) grew.push({ ...first, count, limit })
  }
  const fewer = lintEntries
    .map((entry) => ({ ...entry, found: found.get(entryKey(entry))?.count ?? 0 }))
    .filter((entry) => entry.found < entry.count)
  return { grew, fewer }
}

export function describeProblems({ grew, fewer }) {
  return [
    ...grew.map((d) => {
      // A tool that gives no position (the architecture gate) sets line to 0.
      const first = d.line ? `at ${d.line}:${d.column} ${d.message}` : d.message
      return `Known violations grew: \`${d.rule}\` in \`${d.file}\` (${d.count} found, ${d.limit} listed; first ${first})`
    }),
    ...fewer.map((entry) =>
      entry.found === 0
        ? `Known violation is fixed, remove it: \`${entryKey(entry)}\``
        : `Known violation is fixed, lower the count: \`${entryKey(entry)}\` from ${entry.count} to ${entry.found}`
    )
  ]
}

/** Fails when tsgolint does not run: the g3 fixture must give a type-aware finding. */
export function assertTypeAwareRuns() {
  const found = runOxlint([`${FIXTURES}/g3`], { ignoreFixtures: false })
  if (!found.some((d) => d.rule === 'typescript(no-floating-promises)')) {
    throw new Error('tsgolint did not run: the type-aware rules gave no finding on the g3 fixture.')
  }
}

function main() {
  try {
    run()
  } catch (error) {
    console.error('lint: FAILED')
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

function run() {
  assertTypeAwareRuns()
  const problems = describeProblems(compareWithKnown(runOxlint(['.']), readKnownViolations()))
  if (problems.length === 0) {
    console.log('lint: passed')
    return
  }
  console.error('lint: FAILED')
  for (const problem of problems) console.error(problem)
  process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
