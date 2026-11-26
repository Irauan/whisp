// Tests of scripts/apply-rulesets.mjs (S7). A fake `gh` replaces the real program.
// No test touches the network or the repository settings on GitHub.
import { describe, expect, it } from 'vitest'
import {
  applyRulesets,
  buildRequest,
  parseArgs,
  planRequests,
  readRulesets
} from '../../scripts/apply-rulesets.mjs'

type GhResult = { status: number; stdout: string; stderr: string }
type Call = { args: string[]; input?: string }

const ok = (value: unknown = {}): GhResult => ({
  status: 0,
  stdout: JSON.stringify(value),
  stderr: ''
})

const fail = (stderr: string): GhResult => ({ status: 1, stdout: '', stderr })

/** A fake `gh`. The handler answers each call by its method and endpoint. */
function fakeGh(handler: (method: string, endpoint: string) => GhResult) {
  const calls: Call[] = []
  const gh = (args: string[], input?: string): GhResult => {
    calls.push({ args, input })
    const method = args.includes('--method') ? (args[args.indexOf('--method') + 1] ?? 'GET') : 'GET'
    const endpoint = args.find((arg) => arg.startsWith('repos/')) ?? ''
    return handler(method, endpoint)
  }
  return { gh, calls }
}

const sink = () => {
  const lines: string[] = []
  return { lines, write: (line: string) => void lines.push(line) }
}

const rulesets = [
  { file: 'main.json', name: 'main protection', body: { name: 'main protection', rules: [] } },
  {
    file: 'milestone.json',
    name: 'milestone protection',
    body: { name: 'milestone protection', rules: [] }
  }
]

const REPO = 'someone/example'
const RULESETS = `repos/${REPO}/rulesets`
const writes = (calls: Call[]) => calls.filter((call) => call.args.includes('--method'))
const methodOf = (call: Call) => call.args[call.args.indexOf('--method') + 1]

function run(
  argv: string[],
  gh: (args: string[], input?: string) => GhResult,
  planned: typeof rulesets = rulesets
) {
  const out = sink()
  const status = applyRulesets({ argv, gh, rulesets: planned, log: out.write, error: out.write })
  return { status, text: out.lines.join('\n') }
}

describe('parseArgs', () => {
  it('has the defaults', () => {
    expect(parseArgs([])).toEqual({ dryRun: false, repo: '{owner}/{repo}' })
  })

  it('reads --dry-run and --repo', () => {
    expect(parseArgs(['--dry-run', '--repo', REPO])).toEqual({ dryRun: true, repo: REPO })
  })

  it('rejects an unknown option', () => {
    expect(() => parseArgs(['--force'])).toThrow(/--force/)
  })

  it('rejects --repo without a value', () => {
    expect(() => parseArgs(['--repo'])).toThrow(/--repo/)
  })
})

describe('buildRequest', () => {
  it('builds a POST to create a ruleset', () => {
    expect(buildRequest(REPO, rulesets[0]!, undefined)).toMatchObject({
      action: 'create',
      method: 'POST',
      endpoint: RULESETS,
      name: 'main protection',
      body: rulesets[0]!.body
    })
  })

  it('builds a PUT to update a ruleset by its id', () => {
    expect(buildRequest(REPO, rulesets[0]!, 42)).toMatchObject({
      action: 'update',
      method: 'PUT',
      endpoint: `${RULESETS}/42`
    })
  })
})

describe('planRequests', () => {
  it('creates both when none exists', () => {
    const plan = planRequests(REPO, rulesets, [])
    expect(plan.map((request) => [request.name, request.action])).toEqual([
      ['main protection', 'create'],
      ['milestone protection', 'create']
    ])
  })

  it('updates by name and ignores the other rulesets', () => {
    const existing = [
      { id: 7, name: 'unrelated' },
      { id: 9, name: 'milestone protection' }
    ]
    const plan = planRequests(REPO, rulesets, existing)
    expect(plan.map((request) => [request.name, request.action, request.endpoint])).toEqual([
      ['main protection', 'create', RULESETS],
      ['milestone protection', 'update', `${RULESETS}/9`]
    ])
  })

  it('refuses two existing rulesets with the same name', () => {
    const existing = [
      { id: 1, name: 'main protection' },
      { id: 2, name: 'main protection' }
    ]
    expect(() => planRequests(REPO, rulesets, existing)).toThrow(/main protection/)
  })
})

describe('readRulesets', () => {
  it('reads both files of .github/rulesets', () => {
    const found = readRulesets()
    expect(found.map((ruleset) => ruleset.file)).toEqual(['main.json', 'milestone.json'])
    expect(found.map((ruleset) => ruleset.name)).toEqual([
      'main protection',
      'milestone protection'
    ])
  })
})

describe('applyRulesets', () => {
  it('creates both rulesets when none exists, with the JSON body on stdin', () => {
    const { gh, calls } = fakeGh((method) => (method === 'GET' ? ok([]) : ok({ id: 1 })))
    expect(run(['--repo', REPO], gh).status).toBe(0)
    const sent = writes(calls)
    expect(sent.map(methodOf)).toEqual(['POST', 'POST'])
    for (const call of sent) {
      expect(call.args).toEqual(expect.arrayContaining(['api', RULESETS, '--input', '-']))
    }
    expect(sent.map((call) => JSON.parse(call.input ?? 'null'))).toEqual(
      rulesets.map((ruleset) => ruleset.body)
    )
  })

  it('updates the ruleset that exists and creates the other', () => {
    const { gh, calls } = fakeGh((method) =>
      method === 'GET' ? ok([{ id: 5, name: 'main protection' }]) : ok({ id: 5 })
    )
    run(['--repo', REPO], gh)
    const sent = writes(calls).map((call) => call.args)
    expect(sent[0]).toEqual(expect.arrayContaining(['--method', 'PUT', `${RULESETS}/5`]))
    expect(sent[1]).toEqual(expect.arrayContaining(['--method', 'POST', RULESETS]))
  })

  it('is idempotent: a second run updates what the first run created', () => {
    const store: { id: number; name: string }[] = []
    const { gh, calls } = fakeGh((method) => {
      if (method === 'GET') return ok(store)
      if (method === 'POST') store.push({ id: store.length + 1, name: rulesets[store.length]!.name })
      return ok({})
    })
    run(['--repo', REPO], gh)
    run(['--repo', REPO], gh)
    expect(writes(calls).map(methodOf)).toEqual(['POST', 'POST', 'PUT', 'PUT'])
    expect(store).toHaveLength(2)
  })

  it('stops with status 1 when a write fails', () => {
    const { gh } = fakeGh((method) =>
      method === 'GET' ? ok([]) : fail('HTTP 403: Must have admin rights')
    )
    const { status, text } = run(['--repo', REPO], gh)
    expect(status).toBe(1)
    expect(text).toMatch(/403/)
  })

  it('stops with status 1 and writes nothing when the list fails', () => {
    const { gh, calls } = fakeGh(() => fail('HTTP 401'))
    expect(run(['--repo', REPO], gh).status).toBe(1)
    expect(writes(calls)).toEqual([])
  })

  it('stops with status 2 on a bad option, before any call', () => {
    const { gh, calls } = fakeGh(() => ok())
    expect(run(['--nope'], gh).status).toBe(2)
    expect(calls).toEqual([])
  })

  it('warns when the repository disables a merge method that a ruleset needs', () => {
    const { gh } = fakeGh((method, endpoint) => {
      if (method === 'GET' && endpoint === `repos/${REPO}`) {
        return ok({ allow_merge_commit: true, allow_squash_merge: false })
      }
      return method === 'GET' ? ok([]) : ok({ id: 1 })
    })
    const squashOnly = rulesets.map((ruleset) => ({
      ...ruleset,
      body: {
        ...ruleset.body,
        rules: [{ type: 'pull_request', parameters: { allowed_merge_methods: ['squash'] } }]
      }
    }))
    expect(run(['--repo', REPO], gh, squashOnly).text).toMatch(/allow_squash_merge/)
  })

  describe('--dry-run', () => {
    it('sends no write and prints each request', () => {
      const { gh, calls } = fakeGh((method) =>
        method === 'GET' ? ok([{ id: 5, name: 'main protection' }]) : ok({})
      )
      const { status, text } = run(['--dry-run', '--repo', REPO], gh)
      expect(status).toBe(0)
      expect(writes(calls)).toEqual([])
      expect(text).toContain(`PUT ${RULESETS}/5`)
      expect(text).toContain(`POST ${RULESETS}`)
      expect(text).toContain('"main protection"')
      expect(text).toMatch(/dry run/i)
    })

    it('still prints the requests when a read fails', () => {
      const { gh, calls } = fakeGh(() => fail('HTTP 401'))
      const { status, text } = run(['--dry-run', '--repo', REPO], gh)
      expect(status).toBe(0)
      expect(writes(calls)).toEqual([])
      expect(text).toContain(`POST ${RULESETS}`)
      expect(text).toMatch(/401/)
    })
  })
})
