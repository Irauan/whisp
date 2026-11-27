// A22 of milestone m1-chat, on the built app: the idle limit (decision 0006, spec S9, rule 2).
//
// A22: 7 idle sessions with open processes. The oldest idle process closes. An active session never
// closes for this limit.
//
// The test needs no clock: the seventh turn end triggers the rule (spec, Checks). The setup:
// - The session "Plan the release" runs a turn first, so its idle time is the earliest. Its second
//   turn then waits at the gate "hold" of the simulated agent: it is active, with an open process.
// - Seven more sessions each run one turn, oldest first. The sixth idle process keeps all; the
//   seventh turn end makes 7 idle processes. The oldest idle one, "Session one", closes. The active
//   session would be the oldest if its earlier idle time counted, so the test tells the two apart.
// - When the active turn ends, its idle time starts again, so it is the newest idle process. The
//   7 idle processes then close the next oldest, "Session two", and the session stays.
// Readings of the spec: "the oldest" is the earliest idle time (rule 2), and the idle time starts at
// the end of a turn (Terms of the rule).
// No test sleeps. Each wait is an auto-waiting check of Playwright, a report of the agent, or a poll.
import {
  expect,
  expectEnds,
  expectInTranscript,
  expectRunning,
  openSession,
  processOf,
  reach,
  REPLY_CHUNKS,
  runDraft,
  send,
  startImported,
  test,
  working,
  writeDrafts
} from './fixture'

const ACTIVE = 'Plan the release'
const IDLE = ['Session one', 'Session two', 'Session three', 'Session four', 'Session five', 'Session six', 'Session seven'] as const

test.describe('A22: at most 6 idle processes stay open, and an active session never closes for this limit', () => {
  test('A22: the seventh idle process closes the oldest idle one, never the active session, and the oldest idle one closes again when the active turn ends', async ({
    chat
  }) => {
    // Eight agent processes start one after the other.
    test.slow()
    const { control } = chat
    await control.scenario('text', { chunks: REPLY_CHUNKS })
    await writeDrafts(chat, [ACTIVE, ...IDLE])
    const page = await startImported(chat)

    // The future active session runs a turn first. Then five more sessions: 6 idle processes.
    await runDraft(page, ACTIVE, 'A22')
    for (const prompt of IDLE.slice(0, 5)) await runDraft(page, prompt, 'A22')
    expectRunning(chat, [ACTIVE, ...IDLE.slice(0, 5)], (prompt) => `A22: with 6 idle processes, none may close, but the process of "${prompt}" ended`)

    // The session "Plan the release" becomes active: its next turn waits at the gate.
    await openSession(page, ACTIVE, 'A22')
    await control.scenario('text', { gate: 'hold', chunks: ['Working ', 'on it.'] })
    await send(page, 'Keep going', 'A22')
    await reach(control.waitForGate('hold'), 'A22: the second turn of the session "Plan the release" did not reach the agent.')
    await expect(working(page), 'A22: the session "Plan the release" must show "Working" during its turn.').toBeVisible()
    const active = processOf(chat, ACTIVE, 'A22')
    expect(processOf(chat, 'Keep going', 'A22'), 'A22: the second turn must run in the process of the session "Plan the release".').toBe(active)

    // The sixth idle session: 6 idle processes and the active one. All stay.
    await control.scenario('text', { chunks: REPLY_CHUNKS })
    await runDraft(page, IDLE[5], 'A22')
    expectRunning(chat, [ACTIVE, ...IDLE.slice(0, 6)], (prompt) => `A22: with 6 idle processes and one active, none may close, but the process of "${prompt}" ended`)

    // The seventh idle session: its turn end makes 7 idle processes. The oldest idle one closes.
    await runDraft(page, IDLE[6], 'A22')
    await expectEnds(chat, IDLE[0], 'A22: with 7 idle processes, the oldest idle process, of the session "Session one", did not close.')
    expectRunning(
      chat,
      [ACTIVE],
      (prompt) => `A22: an active session must never close for the idle limit, but the process of "${prompt}" ended during its turn`
    )
    expectRunning(chat, IDLE.slice(1), (prompt) => `A22: only the oldest idle process may close, but the process of "${prompt}" ended`)

    // The active turn ends. Its idle time is now the newest, so the next oldest idle process closes.
    await control.open('hold')
    await reach(control.waitForGatePassed('hold'), 'A22: the turn of the session "Plan the release" did not continue after the gate opened.')
    await expectEnds(
      chat,
      IDLE[1],
      'A22: the end of the active turn made 7 idle processes again, so the oldest idle process, of the session "Session two", must close.'
    )
    expectRunning(
      chat,
      [ACTIVE],
      (prompt) => `A22: the idle time of "${prompt}" starts at the end of its turn, so it is the newest idle process and must stay, but it ended`
    )
    expectRunning(chat, IDLE.slice(2), (prompt) => `A22: 6 idle processes must stay, but the process of "${prompt}" ended`)

    // The session that was active shows its reply and is ready.
    await openSession(page, ACTIVE, 'A22')
    await expectInTranscript(page, 'Working on it.', 'A22: the reply of the active turn does not show.')
  })
})
