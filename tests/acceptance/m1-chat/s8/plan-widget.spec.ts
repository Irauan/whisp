// A11 of milestone m1-chat, and the place, the fold and the life of the plan widget, on the built app.
//
// A11: the agent sends a plan with 3 steps, then marks step 1 completed and step 2 in progress.
// The widget shows "Plan 1 of 3" with the three states. After a restart, the widget shows the
// same plan.
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

  test('Plan widget: it is pinned above the composer, outside the transcript, and later replies come above it', async ({ chat }) => {
    await chat.control.scenario('steps', {
      prompt: [{ do: 'say', text: 'Here is the plan.' }, planUpdate(A11_PROGRESS), { do: 'say', text: 'I work on step 2.' }]
    })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    await startSession(page, 'Plan the change', 'Plan widget, pinned')
    await expectInTranscript(page, 'I work on step 2.', 'Plan widget, pinned: the text of the agent after the plan does not show.')
    await expectReady(page, 'Plan widget, pinned')
    await expectPlan(page, 'Plan 1 of 3', A11_PROGRESS, 'Plan widget, pinned')
    await expectPinned(page, 'Plan widget, pinned')

    // A later turn adds entries to the transcript. They come above the widget, which stays above the composer.
    await chat.control.scenario('text', { chunks: ['The second ', 'reply is here.'] })
    await send(page, 'Go on', 'Plan widget, pinned')
    await expectInTranscript(page, 'The second reply is here.', 'Plan widget, pinned: the reply of the second turn does not show.')
    await expectReady(page, 'Plan widget, pinned (second turn)')
    await expectPlan(page, 'Plan 1 of 3', A11_PROGRESS, 'Plan widget, pinned (second turn)')
    await expectPinned(page, 'Plan widget, pinned (second turn)')
  })

  test('Plan widget: it stays after the turn ends, and the user can fold and unfold it', async ({ chat }) => {
    await chat.control.scenario('steps', {
      prompt: [planUpdate(A11_PROGRESS), { do: 'gate', name: 'fold-turn' }, { do: 'say', text: 'The turn ends now.' }]
    })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    await startSession(page, 'Plan the change', 'Plan widget, fold')

    await reach(chat.control.waitForGate('fold-turn'), 'Plan widget, fold: the agent did not get the prompt, so it sent no plan.')
    await expectPlan(page, 'Plan 1 of 3', A11_PROGRESS, 'Plan widget, during the turn')
    await chat.control.open('fold-turn')
    await expectInTranscript(page, 'The turn ends now.', 'Plan widget, fold: the last text of the turn does not show.')
    await expectReady(page, 'Plan widget, after the turn')

    // It stays after the turn ends.
    await expectPlan(page, 'Plan 1 of 3', A11_PROGRESS, 'Plan widget, it stays after the turn ends')

    // Fold: the count stays, the list of steps is hidden.
    const unfolded = foldButton(page, true)
    await expect(unfolded, 'Plan widget, fold: the plan widget has no button with aria-expanded "true", so the user cannot fold it.').toBeVisible()
    await unfolded.click()
    await expect(foldButton(page, false), 'Plan widget, fold: after a click, the button of the widget must have aria-expanded "false".').toBeVisible()
    await expect(planList(page), 'Plan widget, fold: the folded widget still shows the list of steps.').toBeHidden()
    await expect(planWidget(page), 'Plan widget, fold: the folded widget must still show.').toBeVisible()
    await expect(planWidget(page), 'Plan widget, fold: the folded widget must still show the count "Plan 1 of 3".').toContainText('Plan 1 of 3')

    // Unfold: the steps show again.
    await foldButton(page, false).click()
    await expect(foldButton(page, true), 'Plan widget, unfold: after a second click, the button must have aria-expanded "true".').toBeVisible()
    await expectPlan(page, 'Plan 1 of 3', A11_PROGRESS, 'Plan widget, unfolded again')
  })
})
