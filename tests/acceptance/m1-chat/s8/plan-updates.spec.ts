// The updates of the plan widget, on the built app.
//
// Brief, Plan widget: a new plan replaces the old one in the widget. The transcript shows
// "Updated the plan" at that point. The plan is saved as an entry, so it shows again after a
// restart.
// A change of the states of the same steps is progress, not a new plan: it adds no second
// "Updated the plan" (S4 review note). An empty plan clears the widget (test author reading,
// reported to the coordinator).
//
// The tests count the markers before and after each update. They do not decide if the first plan
// of a session shows "Updated the plan". The fixture describes the UI contract. No test sleeps.
import {
  A11_FIRST,
  A11_PROGRESS,
  A11_STEPS,
  DRAFT_IN_REPO_A,
  expect,
  expectInTranscript,
  expectPlan,
  expectReady,
  inOrder,
  planMarkers,
  planUpdate,
  planWidget,
  reach,
  restartAndOpen,
  send,
  startImported,
  startSession,
  test,
  transcript,
  UPDATED,
  writeOldProfile,
  type Step
} from './fixture'

/** The second plan: other steps, and another number of steps. */
const NEW_PLAN: readonly Step[] = [
  ['Remove the old files', 'in_progress'],
  ['Write the new files', 'pending']
]

test.describe('Plan widget: updates of the plan', () => {
  test('Plan widget: a new plan replaces the old one in the widget, and the transcript shows "Updated the plan" at that point', async ({
    chat
  }) => {
    await chat.control.scenario('steps', {
      prompt: [planUpdate(A11_FIRST), planUpdate(A11_PROGRESS), { do: 'say', text: 'The first plan runs.' }]
    })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    await startSession(page, 'Plan the change', 'New plan')
    await expectInTranscript(page, 'The first plan runs.', 'New plan: the text of the agent after the first plan does not show.')
    await expectReady(page, 'New plan')
    await expectPlan(page, 'Plan 1 of 3', A11_PROGRESS, 'New plan (first plan)')
    const before = await planMarkers(page).count()

    // The second turn: the agent changes course and sends another plan.
    await chat.control.scenario('steps', {
      prompt: [{ do: 'say', text: 'I change the approach.' }, planUpdate(NEW_PLAN), { do: 'say', text: 'Now I follow the new plan.' }]
    })
    await send(page, 'Use another approach', 'New plan')
    await expectInTranscript(page, 'Now I follow the new plan.', 'New plan: the text of the agent after the new plan does not show.')
    await expectReady(page, 'New plan (second turn)')

    // The widget shows only the new plan.
    await expectPlan(page, 'Plan 0 of 2', NEW_PLAN, 'New plan (it replaces the old one)')
    for (const text of A11_STEPS) {
      await expect(planWidget(page), `New plan: the widget still shows the step "${text}" of the old plan.`).not.toContainText(text)
    }

    // One more marker, at the point of the new plan: between the texts around it.
    await expect(planMarkers(page), `New plan: the new plan must add exactly one "${UPDATED}" to the transcript.`).toHaveCount(before + 1)
    await expect(transcript(page), `New plan: "${UPDATED}" must show between "I change the approach." and "Now I follow the new plan.".`).toHaveText(
      inOrder('I change the approach.', UPDATED, 'Now I follow the new plan.')
    )
  })

  test('Plan widget: a change of the step states only adds no second "Updated the plan", also after a restart', async ({ chat }) => {
    const finished: readonly Step[] = [
      [A11_STEPS[0], 'completed'],
      [A11_STEPS[1], 'completed'],
      [A11_STEPS[2], 'in_progress']
    ]
    await chat.control.scenario('steps', {
      prompt: [
        planUpdate(A11_FIRST),
        { do: 'say', text: 'I made a plan.' },
        { do: 'gate', name: 'progress-planned' },
        planUpdate(A11_PROGRESS),
        { do: 'say', text: 'Step 1 is done.' },
        planUpdate(finished),
        { do: 'say', text: 'Step 2 is done.' }
      ]
    })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    let page = await startImported(chat)
    await startSession(page, 'Plan the change', 'Progress')

    // The text after the first plan shows, so the first plan has its place in the transcript.
    await reach(chat.control.waitForGate('progress-planned'), 'Progress: the agent did not get the prompt, so it sent no plan.')
    await expectInTranscript(page, 'I made a plan.', 'Progress: the text of the agent after the first plan does not show.')
    const first = await planMarkers(page).count()
    expect(first, `Progress: the first plan must add at most one "${UPDATED}".`).toBeLessThanOrEqual(1)
    await chat.control.open('progress-planned')

    // Two changes of the states of the same three steps. Neither is a new plan.
    await expectInTranscript(page, 'Step 2 is done.', 'Progress: the text of the agent after the progress does not show.')
    await expectReady(page, 'Progress')
    await expect(
      planMarkers(page),
      `Progress: a change of the step states only must not add "${UPDATED}". The transcript must show it ${first} times, as after the first plan.`
    ).toHaveCount(first)

    // After a restart, the saved entries show the same: progress is not a new plan.
    page = await restartAndOpen(chat, 'Plan the change', 'Progress')
    await expectInTranscript(page, 'Step 2 is done.', 'Progress: after a restart, the transcript does not show the turn.')
    await expect(
      planMarkers(page),
      `Progress: after a restart, the transcript must still show "${UPDATED}" ${first} times. The saved progress must not show as new plans.`
    ).toHaveCount(first)
  })

  test('Plan widget: a plan with no steps clears the widget, also after a restart', async ({ chat }) => {
    await chat.control.scenario('steps', {
      prompt: [
        planUpdate(A11_PROGRESS),
        { do: 'gate', name: 'clear-planned' },
        planUpdate([]),
        { do: 'say', text: 'I cleared the plan.' }
      ]
    })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    let page = await startImported(chat)
    await startSession(page, 'Plan the change', 'Empty plan')

    // First the widget shows the plan.
    await reach(chat.control.waitForGate('clear-planned'), 'Empty plan: the agent did not get the prompt, so it sent no plan.')
    await expectPlan(page, 'Plan 1 of 3', A11_PROGRESS, 'Empty plan (before it)')
    await chat.control.open('clear-planned')

    // Then the plan with no steps clears it.
    await expectInTranscript(page, 'I cleared the plan.', 'Empty plan: the text of the agent after the empty plan does not show.')
    await expectReady(page, 'Empty plan')
    await expect(planWidget(page), 'Empty plan: a plan with no steps must clear the plan widget, but the widget still shows.').toHaveCount(0)

    // After a restart, the latest saved plan is empty, so no widget shows.
    page = await restartAndOpen(chat, 'Plan the change', 'Empty plan')
    await expectInTranscript(page, 'I cleared the plan.', 'Empty plan: after a restart, the transcript does not show the turn.')
    await expect(planWidget(page), 'Empty plan: after a restart, the plan widget shows, but the latest plan has no steps.').toHaveCount(0)
  })
})
