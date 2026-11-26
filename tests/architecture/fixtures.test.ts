// Each gate of S2 has a fixture that breaks its rule. These tests run the tool
// on the fixture and expect the failure, with the file named in the output.
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ACCEPTANCE_RULE,
  blankComments,
  FIXTURES,
  findDisabledAcceptanceTests,
  ROOT,
  runOxlint
} from '../../scripts/lint-gate.mjs'

const TSC = join(ROOT, 'node_modules/typescript/bin/tsc')

function typecheck(fixture: string) {
  const run = spawnSync(process.execPath, [TSC, '-p', `${FIXTURES}/${fixture}/tsconfig.json`], {
    cwd: ROOT,
    encoding: 'utf8'
  })
  return { status: run.status, output: `${run.stdout}${run.stderr}` }
}

function lint(fixture: string) {
  return runOxlint([`${FIXTURES}/${fixture}`], { ignoreFixtures: false }).map(
    (d) => `${d.rule} ${d.file}`
  )
}

describe('typecheck fixtures', () => {
  it('G2: a type error in a main file fails the main config and names the file', () => {
    const { status, output } = typecheck('g2')
    expect(status).not.toBe(0)
    expect(output).toContain('g2/type-error.ts')
    expect(output).toContain('TS2322')
  }, 60_000)

  it('G6: a Node type in a renderer file fails the renderer config and names the file', () => {
    const { status, output } = typecheck('g6')
    expect(status).not.toBe(0)
    expect(output).toContain('g6/renderer/node-type.ts')
    expect(output).toContain("Cannot find name 'Buffer'")
    expect(output).toContain("Cannot find name 'process'")
  }, 60_000)
})

describe('lint fixtures', () => {
  it('G3: a floating promise fails lint', () => {
    expect(lint('g3')).toEqual([
      `typescript(no-floating-promises) ${FIXTURES}/g3/floating-promise.ts`
    ])
  }, 60_000)

  it('G4: localStorage and sessionStorage in renderer code fail lint', () => {
    const found = lint('g4')
    const file = `${FIXTURES}/g4/renderer/local-storage.ts`
    expect(found).toContain(`eslint(no-restricted-globals) ${file}`)
    // One for window.localStorage and two for self.localStorage and self.sessionStorage.
    const properties = found.filter((entry) => entry === `eslint(no-restricted-properties) ${file}`)
    expect(properties).toHaveLength(3)
  }, 60_000)

  it('G4: dangerouslySetInnerHTML in renderer code fails lint', () => {
    expect(lint('g4')).toContain(`react(no-danger) ${FIXTURES}/g4/renderer/raw-html.tsx`)
  }, 60_000)

  it('G10: .only fails lint', () => {
    expect(lint('g10')).toContain(`vitest(no-focused-tests) ${FIXTURES}/g10/only.fixture.ts`)
  }, 60_000)

  it('G10: .skip fails lint', () => {
    expect(lint('g10')).toContain(`vitest(no-disabled-tests) ${FIXTURES}/g10/skip.fixture.ts`)
  }, 60_000)

  it('G10: .only, .skip and .fixme fail the lint gate in an acceptance test, whatever the import', () => {
    // The `test` of these files comes from a Playwright fixture, not from vitest.
    const found = findDisabledAcceptanceTests([`${FIXTURES}/g10/acceptance`]).map(
      (d) => `${d.rule} ${d.file}:${d.line}`
    )
    const only = `${ACCEPTANCE_RULE} ${FIXTURES}/g10/acceptance/only.spec.ts`
    const skip = `${ACCEPTANCE_RULE} ${FIXTURES}/g10/acceptance/skip.spec.ts`
    // The skip fixture ends with calls after a comment, with a string key and with the paren on
    // the next line. It also holds comments with calls inside, which must not count.
    const skipLines = [4, 8, 14, 19, 22, 24, 26, 31, 36]
    expect(found).toEqual([`${only}:4`, `${only}:8`, ...skipLines.map((line) => `${skip}:${line}`)])
  })

  it('G10: the scan of an acceptance test leaves comments out and keeps strings', () => {
    expect(blankComments("a // b\nc /* d\ne */ f 'x // y' g")).toBe("a     \nc     \n     f 'x // y' g")
  })

  it('the acceptance tests of the repository have no .only, .skip or .fixme', () => {
    expect(findDisabledAcceptanceTests()).toEqual([])
  })

  it('a renderer file that imports Electron, Node or main code fails lint', () => {
    const found = lint('g-imports')
    const file = `${FIXTURES}/g-imports/renderer/imports-main.ts`
    expect(found.filter((entry) => entry === `eslint(no-restricted-imports) ${file}`)).toHaveLength(3)
  }, 60_000)

  it('an import type expression fails lint, because dependency-cruiser does not see it', () => {
    const found = lint('g-type-import')
    const file = `${FIXTURES}/g-type-import/type-import.ts`
    // One for `import(...).Other` and one for `typeof import(...)`.
    expect(found.filter((entry) => entry === `typescript(consistent-type-imports) ${file}`)).toHaveLength(2)
  }, 60_000)

  it('a timer in the simulated agent fails lint', () => {
    const found = lint('g-timers')
    const file = `${FIXTURES}/g-timers/simulated-agent/timer.mjs`
    expect(found.filter((entry) => entry === `eslint(no-restricted-globals) ${file}`)).toHaveLength(2)
  }, 60_000)
})
