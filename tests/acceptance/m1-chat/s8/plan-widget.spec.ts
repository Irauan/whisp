// A11, S8-1 and S8-2 of milestone m1-chat: the plan widget, its place, its fold and its life, on the built app.
//
// A11: the agent sends a plan with 3 steps, then marks step 1 completed and step 2 in progress.
// The widget shows "Plan 1 of 3" with the three states. After a restart, the widget shows the
// same plan.
// S8-1: the widget is outside the transcript, below it, above the composer. A later reply comes above it.
// S8-2: the widget stays after the turn. The user folds and unfolds it.
// Brief, Plan widget: the widget shows the latest plan as a todo list, pinned above the composer.
// Each step shows pending (empty circle), in progress (spinner) or completed (check). The header
// shows the count. The user can fold the widget. It stays after the turn ends.
//
// The fixture describes the UI contract. No test sleeps.
import {
  A11_FIRST,
  A11_PROGRESS,
  DRAFT_IN_REPO_A,
  expect,
  expectInTranscript,
  expectPinned,
  expectPlan,
  expectReady,
  foldButton,
  planList,
  planMarkers,
  planUpdate,
  planWidget,
  reach,
  restartAndOpen,
  send,
  startImported,
  startSession,
  test,
  writeOldProfile
} from './fixture'

test.describe('A11 and the plan widget', () => {
  test('A11: the widget shows "Plan 1 of 3" with a completed step, a step in progress and a pending step, and the same plan after a restart', async ({
    chat
  }) => {
    await chat.control.scenario('steps', {
      prompt: [
        { do: 'say', text: 'I made a plan.' },
        planUpdate(A11_FIRST),
        { do: 'gate', name: 'a11-planned' },
        planUpdate(A11_PROGRESS),
        { do: 'gate', name: 'a11-progress' },
        { do: 'say', text: 'The first step is done.' }
      ]
    })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    let page = await startImported(chat)
    await startSession(page, 'Plan the change', 'A11')

    // The plan with three steps, all pending. The count counts the completed steps.
    await reach(chat.control.waitForGate('a11-planned'), 'A11: the agent did not get the prompt, so it sent no plan.')
    await expectInTranscript(page, 'I made a plan.', 'A11: the text of the agent before the plan does not show.')
    await expectPlan(page, 'Plan 0 of 3', A11_FIRST, 'A11 (first plan, three pending steps)')
    await chat.control.open('a11-planned')

    // Step 1 completed, step 2 in progress, step 3 pending.
    await reach(chat.control.waitForGate('a11-progress'), 'A11: the agent did not send the progress of the plan.')
    await expectPlan(page, 'Plan 1 of 3', A11_PROGRESS, 'A11')
    await chat.control.open('a11-progress')
    await expectInTranscript(page, 'The first step is done.', 'A11: the text of the agent after the plan does not show.')
    await expectReady(page, 'A11')
    await expectPlan(page, 'Plan 1 of 3', A11_PROGRESS, 'A11 (after the turn)')
    const markers = await planMarkers(page).count()

    // After a restart, the widget shows the same plan, from the saved entries.
    page = await restartAndOpen(chat, 'Plan the change', 'A11')
    await expectInTranscript(page, 'The first step is done.', 'A11: after a restart, the transcript does not show the turn.')
    await expectPlan(page, 'Plan 1 of 3', A11_PROGRESS, 'A11 (after a restart)')
    await expect(planMarkers(page), `A11: after a restart, the transcript must show "Updated the plan" ${markers} times, as before.`).toHaveCount(
      markers
    )
  })

  test('S8-1: the widget is in the dock, outside the transcript, below it and above the composer, and later replies come above it', async ({
    chat
  }) => {
    await chat.control.scenario('steps', {
      prompt: [{ do: 'say', text: 'Here is the plan.' }, planUpdate(A11_PROGRESS), { do: 'say', text: 'I work on step 2.' }]
    })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    await startSession(page, 'Plan the change', 'S8-1')
    await expectInTranscript(page, 'I work on step 2.', 'S8-1: the text of the agent after the plan does not show.')
    await expectReady(page, 'S8-1')
    await expectPlan(page, 'Plan 1 of 3', A11_PROGRESS, 'S8-1')
    await expectPinned(page, 'S8-1')

    // A later turn adds entries to the transcript. They come above the widget, which stays above the composer.
    await chat.control.scenario('text', { chunks: ['The second ', 'reply is here.'] })
    await send(page, 'Go on', 'S8-1')
    await expectInTranscript(page, 'The second reply is here.', 'S8-1: the reply of the second turn does not show.')
    await expectReady(page, 'S8-1 (second turn)')
    await expectPlan(page, 'Plan 1 of 3', A11_PROGRESS, 'S8-1 (second turn)')
    await expectPinned(page, 'S8-1 (second turn)')
  })

  test('S8-2: the widget stays after the turn ends, and the user can fold and unfold it', async ({ chat }) => {
    await chat.control.scenario('steps', {
      prompt: [planUpdate(A11_PROGRESS), { do: 'gate', name: 'fold-turn' }, { do: 'say', text: 'The turn ends now.' }]
    })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    await startSession(page, 'Plan the change', 'S8-2')

    await reach(chat.control.waitForGate('fold-turn'), 'S8-2: the agent did not get the prompt, so it sent no plan.')
    await expectPlan(page, 'Plan 1 of 3', A11_PROGRESS, 'S8-2 (during the turn)')
    await chat.control.open('fold-turn')
    await expectInTranscript(page, 'The turn ends now.', 'S8-2: the last text of the turn does not show.')
    await expectReady(page, 'S8-2 (after the turn)')

    // It stays after the turn ends.
    await expectPlan(page, 'Plan 1 of 3', A11_PROGRESS, 'S8-2 (it stays after the turn ends)')

    // Fold: the count stays, the list of steps is hidden.
    const unfolded = foldButton(page, true)
    await expect(unfolded, 'S8-2 fold: the plan widget has no button with aria-expanded "true", so the user cannot fold it.').toBeVisible()
    await unfolded.click()
    await expect(foldButton(page, false), 'S8-2 fold: after a click, the button of the widget must have aria-expanded "false".').toBeVisible()
    await expect(planList(page), 'S8-2 fold: the folded widget still shows the list of steps.').toBeHidden()
    await expect(planWidget(page), 'S8-2 fold: the folded widget must still show.').toBeVisible()
    await expect(planWidget(page), 'S8-2 fold: the folded widget must still show the count "Plan 1 of 3".').toContainText('Plan 1 of 3')

    // Unfold: the steps show again.
    await foldButton(page, false).click()
    await expect(foldButton(page, true), 'S8-2 unfold: after a second click, the button must have aria-expanded "true".').toBeVisible()
    await expectPlan(page, 'Plan 1 of 3', A11_PROGRESS, 'S8-2 (unfolded again)')
  })
})
