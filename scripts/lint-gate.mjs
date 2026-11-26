// The lint gate: runs oxlint with tsgolint, then compares the result with the
// lint entries of tests/architecture/known-violations.json.
//
// The list is a JSON array of { "rule": string, "file": string }. A lint entry
// uses the oxlint code as its rule, for example "eslint(no-restricted-globals)".
// One entry covers one rule in one file, whatever the number of occurrences.
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
  let report
  try {
    report = JSON.parse(run.stdout)
  } catch {
    throw new Error(`oxlint gave no JSON report.\n${run.stdout}\n${run.stderr}`)
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

export function readKnownViolations() {
  return JSON.parse(readFileSync(KNOWN_VIOLATIONS_FILE, 'utf8'))
}

/**
 * Compares the lint diagnostics with the known lint entries.
 * @returns {{ grew: object[], stale: object[] }} `grew` holds one diagnostic per
 * unlisted rule and file. `stale` holds the listed entries with no occurrence.
 */
export function compareWithKnown(diagnostics, known) {
  const lintEntries = known.filter((entry) => isLintRule(entry.rule))
  const listed = new Set(lintEntries.map(entryKey))
  const found = new Map()
  for (const d of diagnostics) {
    if (!found.has(entryKey(d))) found.set(entryKey(d), d)
  }
  const grew = [...found].filter(([key]) => !listed.has(key)).map(([, d]) => d)
  const stale = lintEntries.filter((entry) => !found.has(entryKey(entry)))
  return { grew, stale }
}

export function describeProblems({ grew, stale }) {
  return [
    ...grew.map(
      (d) =>
        `Known violations grew: \`${d.rule}\` in \`${d.file}\` (${d.line}:${d.column} ${d.message})`
    ),
    ...stale.map((entry) => `Known violation is fixed, remove it: \`${entryKey(entry)}\``)
  ]
}

function main() {
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
