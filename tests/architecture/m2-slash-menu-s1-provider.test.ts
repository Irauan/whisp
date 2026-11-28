// Story S1 of milestone m2-slash-menu (slash menu): the provider checks S1-1 and S1-2. Spec:
// `docs/milestones/m2-slash-menu/stories/s1-slash-menu.md`, "Behavior" rules 1 to 3 and "Checks".
//
// S1-1 (unit, provider): `available_commands_update` with 4 commands: one with `input: null`, one
//       with a blank name, one `remote-control`. The listener gets one update `commands` with 2
//       entries, in the agent order. The hint of the `null` input is "".
// S1-2 (unit, provider): the list comes before the response to `session/new`. The listener gets the
//       list once the session ID is set (rule 3, open choice 1, A).
//
// Level. The provider is `AcpAgents` with the launch recipe of Claude Code, whose program is the
// simulated agent over real ACP, as in `m1-chat-s10-title-agent.test.ts`. The S1-1 list comes in a
// turn, so no race of the session start decides it. S1-2 uses the scenario `commands` with `early`:
// the agent sends the list before the response, as the session ID is still unknown to the client.
// One more test sends the list right after the response, with no prompt, as the Claude adapter does.
//
// The interface that this test reads (spec, "Interfaces"): the port update
// `{ type: 'commands'; commands: AgentCommand[] }` with `AgentCommand = { name, description, hint }`.
// The type `AgentUpdate` has no `commands` yet, so the test reads each update as plain data. The
// typecheck must pass while the story is not built (S10 and S11 precedent).
//
// Coordinator decision (S5, S9, S10 and S11 precedent of m1-chat): these locked tests run as vitest
// tests in this folder. No test sleeps. A test waits on a report of the simulated agent, or polls
// with a time limit and a message.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentListener, AgentProcess } from '../../src/building-blocks/agent.port'
import { ok } from '../../src/building-blocks/result'
import { AcpAgents } from '../../src/providers/acp/acp-agents'
import { claudeCodeRecipe } from '../../src/providers/claude-code/claude-code'
import { ControlServer } from '../simulated-agent/control'

/** A test with real agent processes needs more than the 5 s of vitest. */
const TIME_LIMIT = 60_000
/** The longest wait for one report or one effect. */
const WAIT = 10_000

/** Whether a process runs. Signal 0 only checks it. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** One update of the port, read as plain data. */
type Update = { type: string } & Record<string, unknown>

const commandsList = (commands: unknown[]) => ({ do: 'update', update: { sessionUpdate: 'available_commands_update', availableCommands: commands } })

let control: ControlServer
let folder: string
let opened: AgentProcess[]

beforeEach(async () => {
  control = await ControlServer.start()
  folder = await mkdtemp(join(tmpdir(), 'aether-m2-s1-agent-'))
  opened = []
})

afterEach(async () => {
  await Promise.all(opened.map((agent) => agent.close()))
  // A process that the product left alive must not outlive the test.
  for (const pid of control.pids) if (isRunning(pid)) process.kill(pid)
  await control.close()
  await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}, TIME_LIMIT)

const agents = () =>
  new AcpAgents({
    recipe: claudeCodeRecipe({ override: async () => ok(control.agent) }),
    environment: () => ({ PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }),
    closeLimitMs: 2000
  })

/** Starts one agent process and collects the updates of the port. */
function start(): { agent: AgentProcess; updates: Update[] } {
  const updates: Update[] = []
  const listener: AgentListener = {
    update: (update) => updates.push(update as unknown as Update),
    exited: () => undefined,
    permission: () => undefined,
    permissionClosed: () => undefined,
    elicitation: () => undefined,
    elicitationClosed: () => undefined
  }
  const agent = agents().start(
    { mainDirectory: folder, additionalDirectories: [], model: 'default', mode: 'ask', sharedItems: [], settings: {}, environment: {}, resume: null },
    listener
  )
  opened.push(agent)
  return { agent, updates }
}

const commandUpdates = (updates: Update[]) => updates.filter((update) => update.type === 'commands')

describe('S1-1: the provider turns available_commands_update into the port update commands', () => {
  it(
    'S1-1: 4 commands with remote-control, a blank name and a null input give one update commands with 2 entries in the agent order; the null input gives the hint ""',
    async () => {
      const check = 'S1-1'
      await control.scenario('steps', {
        prompt: [
          commandsList([
            { name: 'remote-control', description: 'Let the fake remote app continue this session.', input: null },
            { name: 'review', description: 'Review a pull request.', input: { hint: '[pr]' } },
            { name: '   ', description: 'A command with a blank name.', input: null },
            { name: 'compact', description: 'Keep a summary of the conversation.', input: null }
          ]),
          { do: 'say', text: 'Done.' }
        ]
      })
      const { agent, updates } = start()
      expect((await agent.ready).ok, `${check}: the simulated agent did not start.`).toBe(true)
      expect(await agent.prompt('List the commands'), `${check}: the turn did not end.`).toEqual({ ok: true, value: 'end_turn' })
      // The text after the list shows that the listener got the list, if the provider passes it on.
      await expect
        .poll(() => updates.some((update) => update.type === 'text'), { message: `${check}: the listener did not get the text after the list.`, timeout: WAIT })
        .toBe(true)

      expect(
        commandUpdates(updates),
        `${check}: the listener must get exactly one update { type: 'commands', commands } with review (hint "[pr]") and compact (hint ""), in this order, without remote-control and the blank name.`
      ).toEqual([
        {
          type: 'commands',
          commands: [
            { name: 'review', description: 'Review a pull request.', hint: '[pr]' },
            { name: 'compact', description: 'Keep a summary of the conversation.', hint: '' }
          ]
        }
      ])
    },
    TIME_LIMIT
  )
})

describe('S1-2: the provider keeps a list that comes before it knows the session ID', () => {
  it(
    'S1-2: a list that the agent sends before the response to session/new reaches the listener once the session ID is set',
    async () => {
      const check = 'S1-2'
      await control.scenario('commands', { early: true, commands: [{ name: 'review', description: 'Review a pull request.', input: { hint: '[pr]' } }] })
      const { agent, updates } = start()
      expect((await agent.ready).ok, `${check}: the simulated agent did not start.`).toBe(true)
      await expect
        .poll(() => commandUpdates(updates), {
          message: `${check}: the listener must get the list that came before the response to session/new, once, with no prompt.`,
          timeout: WAIT
        })
        .toEqual([{ type: 'commands', commands: [{ name: 'review', description: 'Review a pull request.', hint: '[pr]' }] }])
      expect(control.received('session/prompt'), `${check}: no prompt is needed for the list.`).toEqual([])
    },
    TIME_LIMIT
  )

  it(
    'S1-2: a list that the agent sends right after the response to session/new reaches the listener, with no prompt',
    async () => {
      const check = 'S1-2 (after the response)'
      await control.scenario('commands', { commands: [{ name: 'compact', description: 'Keep a summary of the conversation.', input: null }] })
      const { agent, updates } = start()
      expect((await agent.ready).ok, `${check}: the simulated agent did not start.`).toBe(true)
      await expect
        .poll(() => commandUpdates(updates), { message: `${check}: the listener must get the list that came right after the response, once.`, timeout: WAIT })
        .toEqual([{ type: 'commands', commands: [{ name: 'compact', description: 'Keep a summary of the conversation.', hint: '' }] }])
      expect(control.received('session/prompt'), `${check}: no prompt is needed for the list.`).toEqual([])
    },
    TIME_LIMIT
  )
})
