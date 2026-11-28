// Story S1 of milestone m2-slash-menu (slash menu): the unit checks S1-3 and S1-4 of the renderer.
// Spec: `docs/milestones/m2-slash-menu/stories/s1-slash-menu.md`, "Behavior" rules 9 and 10,
// "Interfaces" (`src/renderer/src/slash.ts`, pure: `findSlash`, `filterCommands`) and "Checks".
//
// S1-3: `filterCommands` with `review`, `preview`, `compact`, `mcp:github:pr`. The query "pr" gives
//       `preview`, then `mcp:github:pr`. The query "re" gives `review`, then `preview`.
// S1-4: `findSlash` with "/re", "  /re", "hi /re", "/re view", the caret at the end. A match for
//       the first two only.
//
// The interface that this test reads. The spec gives the module and the two function names. This
// test fixes the smallest missing parts (test author, 2026-11-28; advisor: not hard to revert):
// - `filterCommands(commands: readonly AgentCommand[], query: string): AgentCommand[]`. It returns
//   the commands that match, in the order of the rule: names that start with the query, then names
//   that contain it, each group in the agent order. No case. The description is not searched.
// - `findSlash(text: string, caret: number)`. It returns null or undefined when the text before the
//   caret is not a command at the start of the text (rule 9, `^\s*\/(\S*)$`). Else it returns a match:
//   the query "re" as a string, or an object whose field `query` is "re".
//
// Coordinator decision (S5, S9, S10 and S11 precedent of m1-chat): these locked unit checks run as
// vitest tests in this folder. The typecheck must pass while the story is not built, so the test
// loads the module at run time and uses its own types.
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(__dirname, '../..')
const SLASH = 'src/renderer/src/slash.ts'

interface AgentCommand {
  name: string
  description: string
  hint: string
}

interface Slash {
  filterCommands(commands: readonly AgentCommand[], query: string): AgentCommand[]
  findSlash(text: string, caret: number): unknown
}

async function loadSlash(check: string, name: keyof Slash): Promise<Slash> {
  if (!existsSync(join(ROOT, SLASH))) throw new Error(`${check}: ${SLASH} is missing.`)
  const module = (await import(join(ROOT, SLASH))) as Partial<Slash>
  if (typeof module[name] !== 'function') throw new Error(`${check}: ${SLASH} exports no function ${name}.`)
  return module as Slash
}

const COMMANDS: AgentCommand[] = [
  { name: 'review', description: 'Review a pull request.', hint: '[pr]' },
  { name: 'preview', description: 'Show a preview of the fake page.', hint: '' },
  // The description holds "pr" and "re", but the filter reads only the name.
  { name: 'compact', description: 'Compress the prompt and keep a summary of the record.', hint: '' },
  { name: 'mcp:github:pr', description: 'Summarize a pull request of the fake GitHub server.', hint: '' }
]

const namesOf = (commands: AgentCommand[]) => commands.map((command) => command.name)

describe('S1-3: filterCommands puts the names that start with the query first, then the names that contain it', () => {
  it('S1-3: the query "pr" gives preview, then mcp:github:pr', async () => {
    const check = 'S1-3'
    const { filterCommands } = await loadSlash(check, 'filterCommands')
    expect(namesOf(filterCommands(COMMANDS, 'pr')), `${check}: the query "pr" must give preview (starts with it), then mcp:github:pr (contains it).`).toEqual([
      'preview',
      'mcp:github:pr'
    ])
  })

  it('S1-3: the query "re" gives review, then preview', async () => {
    const check = 'S1-3'
    const { filterCommands } = await loadSlash(check, 'filterCommands')
    expect(namesOf(filterCommands(COMMANDS, 're')), `${check}: the query "re" must give review (starts with it), then preview (contains it).`).toEqual([
      'review',
      'preview'
    ])
  })

  it('S1-3: the filter has no case, keeps the agent order in each group, gives every command for an empty query, and does not search the description', async () => {
    const check = 'S1-3'
    const { filterCommands } = await loadSlash(check, 'filterCommands')
    expect(namesOf(filterCommands(COMMANDS, 'PR')), `${check}: the filter must have no case: "PR" gives the result of "pr".`).toEqual(['preview', 'mcp:github:pr'])
    expect(namesOf(filterCommands(COMMANDS, '')), `${check}: an empty query must give every command, in the agent order.`).toEqual(namesOf(COMMANDS))
    expect(namesOf(filterCommands(COMMANDS, 'summary')), `${check}: the description must not be searched.`).toEqual([])
    const ordered: AgentCommand[] = [
      { name: 'x-review', description: '', hint: '' },
      { name: 'review-b', description: '', hint: '' },
      { name: 'y-review', description: '', hint: '' },
      { name: 'review-a', description: '', hint: '' }
    ]
    expect(namesOf(filterCommands(ordered, 'review')), `${check}: each group must keep the agent order.`).toEqual(['review-b', 'review-a', 'x-review', 'y-review'])
    expect(namesOf(filterCommands(COMMANDS, 'zzz')), `${check}: a query that matches no name must give no command.`).toEqual([])
  })
})

describe('S1-4: findSlash finds a command only at the start of the text', () => {
  it('S1-4: "/re" and "  /re" match; "hi /re" and "/re view" do not, with the caret at the end', async () => {
    const check = 'S1-4'
    const { findSlash } = await loadSlash(check, 'findSlash')
    const queryOf = (match: unknown) => (typeof match === 'string' ? match : (match as { query?: unknown } | null | undefined)?.query)
    for (const text of ['/re', '  /re']) {
      const match = findSlash(text, text.length)
      expect(match, `${check}: "${text}" with the caret at the end must match.`).toBeTruthy()
      expect(queryOf(match), `${check}: the query of "${text}" must be "re".`).toBe('re')
    }
    for (const text of ['hi /re', '/re view']) {
      const match = findSlash(text, text.length)
      expect(match === null || match === undefined, `${check}: "${text}" with the caret at the end must not match, but gave ${JSON.stringify(match)}.`).toBe(true)
    }
  })

  it('S1-4: the text before the caret counts: "/re view" with the caret after "/re" matches', async () => {
    const check = 'S1-4'
    const { findSlash } = await loadSlash(check, 'findSlash')
    const match = findSlash('/re view', 3)
    expect(match, `${check}: "/re view" with the caret after "/re" must match: only the text before the caret counts (rule 9).`).toBeTruthy()
  })
})
