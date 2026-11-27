// S8-8 of milestone m1-chat: a failed turn in the transcript, on the built app.
//
// S8-8: the agent exits with exit code 7 and a log line. The muted line with an info icon shows
// "exit code 7". The log line is in the fold-out "Show log".
// Spec, "Failed turns in the transcript" (user decision, 2026-11-27): a failed turn shows as one
// muted line with an info icon, at its point in the transcript. It keeps the role `alert` and the
// texts of S4. The last log lines go in a `<details>` inside the alert, "Show log". Brief, States,
// Agent stopped: an error notice with the exit code and the last log lines.
//
// The simulated agent of the scenario `crash` writes the log line, then exits with the code.
// `frame.ts` describes the UI contract. No test sleeps.
import { alerts, DRAFT_IN_REPO_A, expect, expectInTranscript, expectReady, inOrder, send, startImported, startSession, test, transcript, writeOldProfile } from './fixture'
import { colorOf, resolvedColor } from './frame'

test.describe('S8 failed turn', () => {
  test('S8-8: the agent exits with exit code 7 and a log line: a muted line with an info icon shows "exit code 7", and the log line is in the fold-out "Show log"', async ({
    chat
  }) => {
    const check = 'S8-8'
    await chat.control.scenario('text', { chunks: ['Hello ', 'from the agent.'] })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    await startSession(page, 'Say hello', check)
    await expectInTranscript(page, 'Hello from the agent.', `${check}: the first reply does not show.`)
    await expectReady(page, check)

    // The next turn fails: the agent writes a log line and exits with exit code 7.
    const logLine = 'simulated agent: the disk is full'
    await chat.control.scenario('crash', { exitCode: 7, log: logLine })
    await send(page, 'Say it again', check)
    await expect.poll(() => chat.control.received('session/prompt').length, { message: `${check}: the agent got no second prompt.` }).toBe(2)

    // One line in the transcript, at the point of the turn, with the exit code and the role alert.
    const line = transcript(page).getByRole('alert').filter({ hasText: /exit code 7\b/ })
    await expect(line, `${check}: the transcript shows no alert with "exit code 7".`).toHaveCount(1)
    await expect(transcript(page), `${check}: the failed turn must show after the message "Say it again".`).toHaveText(inOrder('Say it again', 'exit code 7'))
    await expect(line.getByText(/exit code 7\b/), `${check}: the line must show "exit code 7".`).toBeVisible()

    // The log line is in the fold-out "Show log", closed at first. Its text stays in the alert (A20).
    const fold = line.locator('details')
    await expect(fold, `${check}: the line has no fold-out (<details>) for the log.`).toHaveCount(1)
    const summary = fold.locator('summary')
    await expect(summary, `${check}: the fold-out of the log must be named "Show log".`).toHaveText('Show log')
    await expect(fold, `${check}: the fold-out must hold the log line of the agent.`).toContainText(logLine)
    await expect(line.getByText(logLine), `${check}: the log line must stay folded until the user opens "Show log".`).toBeHidden()
    await expect(line, `${check}: the text of the alert must still hold the log line (S4, A20).`).toContainText(logLine)

    // The info icon, and the muted color, not the danger color.
    await expect(line.locator('[aria-hidden="true"]').first(), `${check}: the line shows no info icon (an icon with aria-hidden).`).toBeVisible()
    const [muted, danger, color] = await Promise.all([
      resolvedColor(page, 'var(--muted)'),
      resolvedColor(page, 'var(--danger)'),
      colorOf(line.getByText(/exit code 7\b/))
    ])
    expect(color, `${check}: the line must be muted (the color --muted ${muted}), not the danger color ${danger}.`).toBe(muted)

    // "Show log" opens the fold-out.
    await summary.click()
    await expect(line.getByText(logLine), `${check}: after a click on "Show log", the log line does not show.`).toBeVisible()
    await expect(alerts(page).filter({ hasText: /exit code 7\b/ }), `${check}: the failed turn must show as one line, in the transcript only.`).toHaveCount(1)
  })
})
