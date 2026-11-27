// G20 of milestone m0-gates: the contract test.
//
// G20: each contract in the registry has valid and invalid examples, and each example gives the
// expected result. The test also covers the rule "Each contract is in the registry and has
// examples" of `docs/architecture.md` (checkable rules).
//
// The interface that this test reads. It follows `docs/milestones/m0-gates/plan.md`, path step 2:
// - `src/app/contracts.ts` exports `contracts`, the registry: an array or an object of contracts.
// - A contract comes from `defineContract(name, input, result, errors, examples)` in
//   `src/building-blocks/contract.ts`. It has these properties:
//   - `name`: the name for `invoke`, for example `profiles.list-github-accounts`;
//   - `input`: the zod schema of the input;
//   - `examples.valid`: inputs that the input schema accepts, at least one;
//   - `examples.invalid`: inputs that the input schema rejects, at least one.
// - Each `src/features/**/*.contract.ts` file exports its contract.
//
// The test loads the modules at run time, so the typecheck does not depend on files that the
// story adds.
import { existsSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../..')
const REGISTRY = 'src/app/contracts.ts'
const FEATURES = 'src/features'
/**
 * The contract of the GitHub accounts query, the example slice of path step 2. User decision,
 * 2026-11-26: "Profile" everywhere, so `workspaces.list-github-accounts` is now
 * `profiles.list-github-accounts`.
 */
const LIST_GITHUB_ACCOUNTS = 'profiles.list-github-accounts'

interface Schema {
  safeParse(value: unknown): { success: boolean }
}

interface Contract {
  name: string
  input: Schema
  examples: { valid: unknown[]; invalid: unknown[] }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  (typeof value === 'object' || typeof value === 'function') && value !== null

const isSchema = (value: unknown): value is Schema => isObject(value) && typeof value.safeParse === 'function'

/** A value that has the shape of a contract: a name and an input schema. */
const looksLikeContract = (value: unknown): value is Contract =>
  isObject(value) && typeof value.name === 'string' && isSchema(value.input)

const load = (file: string): Promise<Record<string, unknown>> => import(join(ROOT, file))

/** The contracts of the registry. */
async function registry(): Promise<unknown[]> {
  if (!existsSync(join(ROOT, REGISTRY))) throw new Error(`The contract registry ${REGISTRY} does not exist.`)
  const { contracts } = await load(REGISTRY)
  if (!isObject(contracts)) throw new Error(`${REGISTRY} exports no registry named "contracts".`)
  return Array.isArray(contracts) ? contracts : Object.values(contracts)
}

/** The `*.contract.ts` files under `src/features`, relative to the root, with `/`. */
function contractFiles(): string[] {
  const folder = join(ROOT, FEATURES)
  if (!existsSync(folder)) return []
  return readdirSync(folder, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.contract.ts'))
    .map((name) => relative(ROOT, join(folder, name)).replaceAll('\\', '/'))
    .sort()
}

/** The problems of one contract, as text. An empty list means that the contract is correct. */
function problemsOf(contract: unknown, index: number): string[] {
  if (!looksLikeContract(contract)) return [`Entry ${index} of the registry is not a contract with a name and a zod input schema.`]
  const { name, examples } = contract
  const problems: string[] = []
  const valid = isObject(examples) ? examples.valid : undefined
  const invalid = isObject(examples) ? examples.invalid : undefined
  if (!Array.isArray(valid) || valid.length === 0) problems.push(`${name}: it has no valid examples.`)
  if (!Array.isArray(invalid) || invalid.length === 0) problems.push(`${name}: it has no invalid examples.`)
  for (const example of Array.isArray(valid) ? valid : []) {
    if (!contract.input.safeParse(example).success) {
      problems.push(`${name}: the input schema rejects the valid example ${JSON.stringify(example)}.`)
    }
  }
  for (const example of Array.isArray(invalid) ? invalid : []) {
    if (contract.input.safeParse(example).success) {
      problems.push(`${name}: the input schema accepts the invalid example ${JSON.stringify(example)}.`)
    }
  }
  return problems
}

describe('G20: the contract registry', () => {
  it('G20: the registry holds the contract of the GitHub accounts query', async () => {
    const contracts = await registry()
    const names = contracts.filter(looksLikeContract).map((contract) => contract.name)
    expect(names, `The registry has no contract named ${LIST_GITHUB_ACCOUNTS}.`).toContain(LIST_GITHUB_ACCOUNTS)
  })

  it('G20: each contract in the registry has a unique name', async () => {
    const names = (await registry()).filter(looksLikeContract).map((contract) => contract.name)
    const twice = names.filter((name, index) => names.indexOf(name) !== index)
    expect(twice, 'These names are in the registry more than once.').toEqual([])
  })

  it('G20: each contract has valid and invalid examples, and each example gives the expected result', async () => {
    const contracts = await registry()
    expect(contracts.length, 'The registry is empty.').toBeGreaterThan(0)
    const problems = contracts.flatMap((contract, index) => problemsOf(contract, index))
    expect(problems).toEqual([])
  })

  it('G20: each contract file under src/features exports a contract that is in the registry', async () => {
    const files = contractFiles()
    expect(files, `No *.contract.ts file exists under ${FEATURES}.`).not.toEqual([])
    const listed = new Set((await registry()).filter(looksLikeContract).map((contract) => contract.name))
    const problems: string[] = []
    for (const file of files) {
      const exported = Object.values(await load(file)).filter(looksLikeContract)
      if (exported.length === 0) problems.push(`${file}: it exports no contract.`)
      for (const contract of exported) {
        if (!listed.has(contract.name)) problems.push(`${file}: the contract ${contract.name} is not in ${REGISTRY}.`)
      }
    }
    expect(problems).toEqual([])
  })
})
