// Tests of the ruleset files (S7). The required checks must equal the jobs of ci.yml,
// so a renamed job fails here before it blocks every merge on GitHub.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const read = (path: string) => readFileSync(`${ROOT}${path}`, 'utf8').replaceAll('\r\n', '\n')

type Rule = { type: string; parameters?: Record<string, unknown> }
type Ruleset = {
  name: string
  target: string
  enforcement: string
  bypass_actors: unknown[]
  conditions: { ref_name: { include: string[]; exclude: string[] } }
  rules: Rule[]
}

const load = (file: string) => JSON.parse(read(`.github/rulesets/${file}`)) as Ruleset
const FILES = { main: load('main.json'), milestone: load('milestone.json') }
const ruleOf = (ruleset: Ruleset, type: string) => ruleset.rules.find((rule) => rule.type === type)

/** The job ids of ci.yml, and the job ids that set their own `name:`. */
function readJobs(yaml: string) {
  const lines = yaml.split('\n')
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line))
  if (start < 0) throw new Error('ci.yml has no jobs: section.')
  const ids: string[] = []
  const named: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break
    const id = /^ {2}([\w-]+):\s*$/.exec(line)
    if (id) ids.push(id[1]!)
    else if (/^ {4}name:/.test(line) && ids.length > 0) named.push(ids[ids.length - 1]!)
  }
  return { ids, named }
}

const checkNames = (ruleset: Ruleset) => {
  const rule = ruleOf(ruleset, 'required_status_checks')
  const checks = (rule?.parameters?.required_status_checks ?? []) as { context: string }[]
  return checks.map((check) => check.context)
}

describe('required checks and ci.yml', () => {
  const { ids, named } = readJobs(read('.github/workflows/ci.yml'))

  it('finds the six gate jobs in ci.yml', () => {
    expect([...ids].sort()).toEqual(
      ['acceptance', 'architecture', 'lint', 'lock', 'typecheck', 'unit'].sort()
    )
  })

  it('has no job with its own name, because the check context would change', () => {
    expect(named).toEqual([])
  })

  for (const [label, ruleset] of Object.entries(FILES)) {
    it(`requires in ${label}.json exactly the jobs of ci.yml`, () => {
      expect([...checkNames(ruleset)].sort()).toEqual([...ids].sort())
    })
  }

  it('detects a renamed job', () => {
    const renamed = read('.github/workflows/ci.yml').replace(/^ {2}unit:/m, '  tests:')
    const { ids: renamedIds } = readJobs(renamed)
    expect([...checkNames(FILES.main)].sort()).not.toEqual([...renamedIds].sort())
  })
})

describe('both rulesets', () => {
  for (const [label, ruleset] of Object.entries(FILES)) {
    describe(`${label}.json`, () => {
      it('is active, on branches, and has no bypass actor', () => {
        expect(ruleset.target).toBe('branch')
        expect(ruleset.enforcement).toBe('active')
        expect(ruleset.bypass_actors).toEqual([])
      })

      it('forbids force push and deletion', () => {
        expect(ruleOf(ruleset, 'non_fast_forward')).toBeDefined()
        expect(ruleOf(ruleset, 'deletion')).toBeDefined()
      })

      it('requires signed commits', () => {
        expect(ruleOf(ruleset, 'required_signatures')).toBeDefined()
      })

      it('requires a PR with no approval', () => {
        const parameters = ruleOf(ruleset, 'pull_request')?.parameters
        expect(parameters).toBeDefined()
        expect(parameters?.required_approving_review_count).toBe(0)
        expect(parameters?.require_code_owner_review).toBe(false)
      })

      it('requires up-to-date checks from GitHub Actions', () => {
        const parameters = ruleOf(ruleset, 'required_status_checks')?.parameters
        expect(parameters?.strict_required_status_checks_policy).toBe(true)
        const checks = parameters?.required_status_checks as { integration_id: number }[]
        expect(checks.every((check) => check.integration_id === 15368)).toBe(true)
      })

      it('has each rule type once', () => {
        const types = ruleset.rules.map((rule) => rule.type)
        expect(new Set(types).size).toBe(types.length)
      })
    })
  }

  it('protects main and milestone branches, and nothing more', () => {
    expect(FILES.main.conditions.ref_name).toEqual({ include: ['refs/heads/main'], exclude: [] })
    expect(FILES.milestone.conditions.ref_name).toEqual({
      include: ['refs/heads/milestone/**'],
      exclude: []
    })
  })

  it('allows merge commits only on main', () => {
    expect(ruleOf(FILES.main, 'pull_request')?.parameters?.allowed_merge_methods).toEqual(['merge'])
  })

  it('allows squash only on milestone branches', () => {
    expect(ruleOf(FILES.milestone, 'pull_request')?.parameters?.allowed_merge_methods).toEqual([
      'squash'
    ])
  })

  it('uses two different names', () => {
    expect(FILES.main.name).not.toBe(FILES.milestone.name)
  })
})
