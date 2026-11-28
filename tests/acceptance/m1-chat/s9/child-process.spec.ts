// S9-4 of story S9 of milestone m1-chat, on the built app (spec S9, open choice 6, A, decided by
// the user): after a release, no process of the agent tree runs. The simulated agent starts a
// child that outlives its parent (`docs/architecture.md`, Tests: "a child process that outlives
// its parent").
//
// Level: acceptance, the level that the spec leaves open and the coordinator chose. The release
// needs no clock: the seventh idle process closes the oldest idle one (A22, rule 2). The oldest is
// the session "Start a helper", whose agent started the child.
//
// The child is detached: it does not end when the agent ends. The agent ends by itself when its
// stdin closes, so a close that kills the tree only after its limit leaves the child alive. The fix
// of the spec lists the tree before stdin closes, and kills each listed process that still runs.
// The fixture kills the child at the end of the test in any case.
// No test sleeps. Each wait is an auto-waiting check of Playwright, a report of the agent, or a poll.
import { expect, expectEnds, isRunning, processOf, reach, REPLY_CHUNKS, runDraft, startImported, test, writeDrafts } from './fixture'

const HELPER = 'Start a helper'
const OTHERS = ['Session two', 'Session three', 'Session four', 'Session five', 'Session six', 'Session seven'] as const

test.describe('S9-4: after a release, no process of the agent tree runs', () => {
  test('S9-4: when the idle limit releases the process whose agent started a child process, the child process ends too', async ({ chat }) => {
    // Seven agent processes start one after the other.
    test.slow()
    const { control } = chat
    await writeDrafts(chat, [HELPER, ...OTHERS])
    const page = await startImported(chat)

    // The agent of the oldest session starts a child that outlives it.
    await control.scenario('child-process', { chunks: REPLY_CHUNKS })
    await runDraft(page, HELPER, 'S9-4')
    const child = await reach(control.waitForChild(), 'S9-4: the agent of the session "Start a helper" reported no child process.')
    const agent = processOf(chat, HELPER, 'S9-4')
    expect(child.parent, 'S9-4: the child must be a child of the agent of the session "Start a helper".').toBe(agent)
    expect(isRunning(child.pid), 'S9-4: the child process must run before the release.').toBe(true)

    // Six more idle sessions: the seventh turn end releases the oldest idle process.
    await control.scenario('text', { chunks: REPLY_CHUNKS })
    for (const prompt of OTHERS) await runDraft(page, prompt, 'S9-4')
    await expectEnds(chat, HELPER, 'S9-4: with 7 idle processes, the oldest idle process, of the session "Start a helper", did not close, so no release ran.')

    await expect
      .poll(() => isRunning(child.pid), {
        message: `S9-4: after the release, the child process ${child.pid} of the agent still runs. No process of the agent tree may outlive the release.`
      })
      .toBe(false)
  })
})
