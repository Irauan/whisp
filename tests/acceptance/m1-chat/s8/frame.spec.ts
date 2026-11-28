// The session window frame of story S8 of milestone m1-chat, on the built app.
//
// Spec, "The session window frame" (user decision, 2026-11-27): the session window is a fixed
// frame. The title strip (the title and "Session options", story S10) is at the top. The
// transcript is the only scroll area. The bottom dock (status line, plan widget, composer) is always in view.
// Spec, "Conditions for the locked tests":
// - The log "Transcript" is the scroll element itself. A wrapper around it must not scroll.
// - `.content` stops scrolling for the session page. Otherwise the page scrolls.
// - The log always has a height above zero, also with a tall dock. The parts of the dock that can
//   grow have a cap: the list of the plan widget, and the text area.
// - The dock itself never scrolls. The composer is always fully in view.
// - The transcript stays at the bottom while new entries and streamed text arrive. When the user
//   scrolls up, it keeps the position. Back at the bottom, it follows new entries again.
// - The header shows only the title and the button "Delete session". The facts row goes away.
//   S10 (user decision, 2026-11-28): the header row goes away. The title and the button
//   "Session options" are in the title strip, and "Delete session" is an item of its menu.
//
// The checks read the frame before any action in the composer, because an action of Playwright
// scrolls its target into view. `frame.ts` describes the UI contract. No test sleeps.
import {
  DRAFT_IN_REPO_A,
  expect,
  expectInTranscript,
  expectPinned,
  folderPath,
  main,
  planUpdate,
  planWidget,
  promptField,
  reach,
  sendButton,
  startImported,
  startSession,
  stopButton,
  test,
  transcript,
  working,
  writeOldProfile,
  type Step
} from './fixture'
import { expectComposerInView, isAtBottom, linesOf, nextFrames, scrollersAround, scrollFacts, scrollsInside, wheelOver } from './frame'

/** A reply that is much taller than the window. */
const LONG_REPLY = linesOf(150, 'the long reply')

test.describe('S8 session frame', () => {
  test('Frame (Conditions for the locked tests): the log "Transcript" is the scroll element, no wrapper and no page scrolls, and the header and the composer stay in view', async ({
    chat
  }) => {
    const check = 'S8 frame, the log is the scroll element'
    await chat.control.scenario('text', { chunks: [LONG_REPLY] })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    await startSession(page, 'Write a long reply', check)
    const log = transcript(page)
    await expect(log, `${check}: the long reply does not show.`).toContainText('Line 150 of the long reply.')
    await expect(stopButton(page), `${check}: the turn does not end.`).toHaveCount(0)

    // The log holds more than its room, and it scrolls itself.
    const facts = await scrollFacts(log)
    expect(
      facts.scrollHeight,
      `${check}: the log "Transcript" holds a reply of 150 lines, but it has no overflow (content ${facts.scrollHeight}px in ${facts.clientHeight}px). The log must be the scroll element, with a height that the frame limits.`
    ).toBeGreaterThan(facts.clientHeight + 1)
    expect(facts.overflowY, `${check}: the log "Transcript" must scroll itself, with overflow-y auto or scroll.`).toMatch(/auto|scroll|overlay/)
    expect(await scrollersAround(log), `${check}: an element around the log "Transcript" scrolls, or the page scrolls. Only the log may scroll.`).toEqual([])

    // The header and the composer are in view.
    const heading = main(page).getByRole('heading', { level: 1, name: 'Write a long reply' })
    const options = main(page).getByRole('button', { name: 'Session options', exact: true })
    await expect(heading, `${check}: the title of the session is not fully in view at the top.`).toBeInViewport({ ratio: 1 })
    await expect(options, `${check}: the button "Session options" is not fully in view at the top.`).toBeInViewport({ ratio: 1 })
    await expectComposerInView(promptField(page), sendButton(page), check)
    expect(await scrollersAround(promptField(page)), `${check}: an element around the text field "Prompt" scrolls. The dock must never scroll.`).toEqual([])

    // The user scrolls the log to the top, then down a little. Only the log moves.
    await wheelOver(page, log, -100_000, check)
    await expect.poll(async () => (await scrollFacts(log)).scrollTop, { message: `${check}: the wheel does not scroll the log to the top.` }).toBe(0)
    await wheelOver(page, log, 600, check)
    await expect.poll(async () => (await scrollFacts(log)).scrollTop, { message: `${check}: the wheel does not scroll the log down.` }).toBeGreaterThan(0)
    await expect(heading, `${check}: after a scroll of the log, the title is not in view.`).toBeInViewport({ ratio: 1 })
    await expectComposerInView(promptField(page), sendButton(page), `${check} (after a scroll of the log)`)
    expect(await scrollersAround(log), `${check}: after a scroll of the log, an element around it or the page scrolled.`).toEqual([])
    expect(await scrollersAround(promptField(page)), `${check}: after a scroll of the log, an element around "Prompt" scrolled.`).toEqual([])
  })

  test('Frame (Conditions for the locked tests): the transcript follows new entries only at the bottom, and keeps the position when the user scrolled up', async ({
    chat
  }) => {
    const check = 'S8 frame, follow'
    const tool = (id: string, title: string) =>
      ({ do: 'update', update: { sessionUpdate: 'tool_call', toolCallId: id, title, kind: 'read', status: 'completed' } }) as const
    await chat.control.scenario('steps', {
      prompt: [
        { do: 'say', text: linesOf(150, 'the first part') },
        { do: 'gate', name: 'follow-1' },
        { do: 'say', text: `\n${linesOf(40, 'the second part')}` },
        { do: 'gate', name: 'follow-2' },
        tool('follow-read-1', 'Read notes.txt'),
        { do: 'say', text: linesOf(40, 'the third part') },
        { do: 'gate', name: 'follow-3' },
        tool('follow-read-2', 'Read todo.txt'),
        { do: 'say', text: linesOf(40, 'the last part') }
      ]
    })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    await startSession(page, 'Write a long reply', check)
    const log = transcript(page)

    // Streamed text: the log stays at the bottom.
    await reach(chat.control.waitForGate('follow-1'), `${check}: the agent did not get the prompt.`)
    await expect(log, `${check}: the first part of the reply does not show.`).toContainText('Line 150 of the first part.')
    const facts = await scrollFacts(log)
    expect(
      facts.scrollHeight,
      `${check}: the log "Transcript" holds 150 lines, but it has no overflow (content ${facts.scrollHeight}px in ${facts.clientHeight}px). The log must be the scroll element.`
    ).toBeGreaterThan(facts.clientHeight + 1)
    await expect.poll(() => isAtBottom(log), { message: `${check}: while the reply streams, the log "Transcript" does not stay at the bottom.` }).toBe(true)

    // The status line "Working" is in the dock: below the log, above "Prompt", and in view.
    await expect(working(page), `${check}: the status line "Working" is not fully in view during the turn.`).toBeInViewport({ ratio: 1 })
    const [status, logBox, field] = await Promise.all([working(page).boundingBox(), log.boundingBox(), promptField(page).boundingBox()])
    if (!status || !logBox || !field) throw new Error(`${check}: the status line, the log or "Prompt" has no box.`)
    expect(status.y, `${check}: the status line "Working" must sit in the dock, below the log "Transcript".`).toBeGreaterThanOrEqual(logBox.y + logBox.height - 1)
    expect(status.y + status.height, `${check}: the status line "Working" must sit above the text field "Prompt".`).toBeLessThanOrEqual(field.y + 1)

    await chat.control.open('follow-1')
    await reach(chat.control.waitForGate('follow-2'), `${check}: the agent did not stream the second part.`)
    await expect(log, `${check}: the second part of the reply does not show.`).toContainText('Line 40 of the second part.')
    await expect.poll(() => isAtBottom(log), { message: `${check}: when more streamed text came, the log "Transcript" did not stay at the bottom.` }).toBe(true)

    // The user scrolls up. New entries come below, and the log keeps the position of the user.
    await wheelOver(page, log, -1200, check)
    await expect.poll(() => isAtBottom(log), { message: `${check}: the wheel does not scroll the log up.` }).toBe(false)
    let position = -1
    await expect
      .poll(
        async () => {
          const before = (await scrollFacts(log)).scrollTop
          await nextFrames(page)
          position = (await scrollFacts(log)).scrollTop
          return position === before
        },
        { message: `${check}: the log does not come to rest after the user scrolled up.` }
      )
      .toBe(true)
    await chat.control.open('follow-2')
    await reach(chat.control.waitForGate('follow-3'), `${check}: the agent did not send the third part.`)
    await expect(log.getByRole('group', { name: 'Read notes.txt' }), `${check}: the new tool call does not show.`).toHaveCount(1)
    await expect(log, `${check}: the third part of the reply does not show.`).toContainText('Line 40 of the third part.')
    await nextFrames(page)
    expect(
      Math.abs((await scrollFacts(log)).scrollTop - position),
      `${check}: the user scrolled up, but new entries moved the log away from the position of the user (scrollTop ${position}).`
    ).toBeLessThanOrEqual(2)
    expect(await isAtBottom(log), `${check}: the user scrolled up, but the log jumped to the bottom when new entries came.`).toBe(false)

    // The user scrolls back to the bottom. The log follows new entries again.
    await wheelOver(page, log, 100_000, check)
    await expect.poll(() => isAtBottom(log), { message: `${check}: the wheel does not scroll the log back to the bottom.` }).toBe(true)
    await chat.control.open('follow-3')
    await expect(log.getByRole('group', { name: 'Read todo.txt' }), `${check}: the last tool call does not show.`).toHaveCount(1)
    await expect(log, `${check}: the last part of the reply does not show.`).toContainText('Line 40 of the last part.')
    await expect
      .poll(() => isAtBottom(log), { message: `${check}: back at the bottom, the log "Transcript" does not follow the new entries again.` })
      .toBe(true)
    await expect(stopButton(page), `${check}: the turn does not end.`).toHaveCount(0)
  })

  test('Frame (Conditions for the locked tests): with a tall dock, the list of the plan scrolls inside, the log keeps a height above zero, and the composer stays in view', async ({
    chat
  }) => {
    const check = 'S8 frame, tall dock'
    const longPlan: Step[] = Array.from({ length: 40 }, (_, index) => [`Step ${index + 1} of the long plan`, index === 0 ? 'in_progress' : 'pending'])
    await chat.control.scenario('steps', {
      prompt: [{ do: 'say', text: 'Here is a long plan.' }, planUpdate(longPlan), { do: 'gate', name: 'tall-dock' }, { do: 'say', text: 'I start with step 1.' }]
    })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    await startSession(page, 'Plan a long change', check)

    // During the turn, the dock holds, from the top: the status line, the plan widget, the composer.
    await reach(chat.control.waitForGate('tall-dock'), `${check}: the agent did not get the prompt, so it sent no plan.`)
    await expect(planWidget(page), `${check}: the session window has no region "Plan", so no plan widget shows.`).toBeVisible()
    await expect(working(page), `${check}: the status line "Working" is not fully in view during the turn.`).toBeInViewport({ ratio: 1 })
    const [status, widget] = await Promise.all([working(page).boundingBox(), planWidget(page).boundingBox()])
    if (!status || !widget) throw new Error(`${check}: the status line or the plan widget has no box.`)
    expect(status.y + status.height, `${check}: the status line "Working" must sit above the plan widget, in the dock.`).toBeLessThanOrEqual(widget.y + 1)
    await chat.control.open('tall-dock')
    await expectInTranscript(page, 'I start with step 1.', `${check}: the text of the agent after the plan does not show.`)
    await expect(stopButton(page), `${check}: the turn does not end.`).toHaveCount(0)

    // A plan of 40 steps: the widget caps its list, and the list scrolls in its own area.
    await expect(planWidget(page), `${check}: the session window has no region "Plan", so no plan widget shows.`).toBeVisible()
    expect(await scrollsInside(planWidget(page)), `${check}: the plan widget shows 40 steps, but no part of it scrolls. Its list must have a cap and scroll inside.`).toBe(
      true
    )
    expect(await scrollersAround(promptField(page)), `${check}: an element around the text field "Prompt" scrolls. The dock must never scroll.`).toEqual([])
    await expectComposerInView(promptField(page), sendButton(page), check)
    const log = await transcript(page).boundingBox()
    expect(log?.height ?? 0, `${check}: with the long plan in the dock, the log "Transcript" has no height.`).toBeGreaterThan(0)
    await expectPinned(page, check)
    expect(await scrollersAround(promptField(page)), `${check}: after the place check, an element around "Prompt" has a scroll offset.`).toEqual([])

    // A prompt of 12 lines makes the dock taller still. The text area has a cap too.
    await promptField(page).fill(linesOf(12, 'the next message'))
    await nextFrames(page)
    expect(await scrollersAround(promptField(page)), `${check}: with a prompt of 12 lines, an element around "Prompt" scrolls.`).toEqual([])
    await expectComposerInView(promptField(page), sendButton(page), `${check} (prompt of 12 lines)`)
    const shorter = await transcript(page).boundingBox()
    expect(shorter?.height ?? 0, `${check}: with the long plan and a prompt of 12 lines, the log "Transcript" has no height.`).toBeGreaterThan(0)
    await expectPinned(page, `${check} (prompt of 12 lines)`)
  })

  test('Frame, header: the title strip holds only the title and "Session options", with no facts row', async ({ chat }) => {
    const check = 'S8 frame, header'
    await chat.control.scenario('text', { chunks: ['Hello ', 'from the agent.'] })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    await startSession(page, 'Say hello', check)
    await expectInTranscript(page, 'Hello from the agent.', `${check}: the reply does not show.`)
    await expect(stopButton(page), `${check}: the turn does not end.`).toHaveCount(0)

    await expect(main(page).getByRole('heading', { level: 1, name: 'Say hello' }), `${check}: the title strip does not show the title.`).toBeVisible()
    await expect(main(page).getByRole('button', { name: 'Session options', exact: true }), `${check}: the title strip has no button "Session options".`).toBeVisible()

    // No facts row: no Profile, no Folder, no folder path.
    for (const fact of ['Profile', 'Folder']) {
      await expect(main(page).getByText(fact, { exact: true }).filter({ visible: true }), `${check}: the session window still shows the fact "${fact}".`).toHaveCount(0)
    }
    await expect(
      main(page).getByText(folderPath(chat, 'repo-a')).filter({ visible: true }),
      `${check}: the session window still shows the folder of the session.`
    ).toHaveCount(0)
    await expect(main(page).getByRole('term'), `${check}: the session window still has a facts list.`).toHaveCount(0)

    // Above the log, the only button is "Session options".
    const top = (await transcript(page).boundingBox())?.y ?? 0
    const above: string[] = []
    for (const button of await main(page).getByRole('button').filter({ visible: true }).all()) {
      const box = await button.boundingBox()
      if (box && box.y + box.height <= top + 1) above.push((await button.getAttribute('aria-label')) ?? (await button.innerText()))
    }
    expect(above, `${check}: the title strip must hold only the button "Session options".`).toEqual(['Session options'])
  })
})
