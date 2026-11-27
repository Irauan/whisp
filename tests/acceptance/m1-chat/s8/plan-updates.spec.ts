// S8-3, S8-4 and S8-5 of milestone m1-chat: the updates of the plan widget, on the built app.
//
// Brief, Plan widget: a new plan replaces the old one in the widget. The transcript shows
// "Updated the plan" at that point. The plan is saved as an entry, so it shows again after a
// restart.
// S8-3: a new plan replaces the old one and adds one "Updated the plan" at its point.
// S8-4: a change of the step states only adds no "Updated the plan", also after a restart.
// S8-5: a plan with no steps clears the widget, also after a restart.
// Spec, Flow, rule 5: the transcript shows "Updated the plan" at each plan entry except the first
// one of the session. Spec, States: an empty plan also shows it.
//
// The fixture describes the UI contract. No test sleeps.
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
  test('S8-3: a new plan replaces the old one in the widget, and the transcript shows one "Updated the plan" at that point', async ({ chat }) => {
    await chat.control.scenario('steps', {
      prompt: [planUpdate(A11_FIRST), planUpdate(A11_PROGRESS), { do: 'say', text: 'The first plan runs.' }]
    })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    await startSession(page, 'Plan the change', 'S8-3')
    await expectInTranscript(page, 'The first plan runs.', 'S8-3: the text of the agent after the first plan does not show.')
    await expectReady(page, 'S8-3')
    await expectPlan(page, 'Plan 1 of 3', A11_PROGRESS, 'S8-3 (first plan)')
    await expect(
      planMarkers(page),
      `S8-3 (spec, Flow, rule 5): the first plan of the session and its progress must show no "${UPDATED}".`
    ).toHaveCount(0)

    // The second turn: the agent changes course and sends another plan.
    await chat.control.scenario('steps', {
      prompt: [{ do: 'say', text: 'I change the approach.' }, planUpdate(NEW_PLAN), { do: 'say', text: 'Now I follow the new plan.' }]
    })
    await send(page, 'Use another approach', 'S8-3')
    await expectInTranscript(page, 'Now I follow the new plan.', 'S8-3: the text of the agent after the new plan does not show.')
    await expectReady(page, 'S8-3 (second turn)')

    // The widget shows only the new plan.
    await expectPlan(page, 'Plan 0 of 2', NEW_PLAN, 'S8-3 (it replaces the old one)')
    for (const text of A11_STEPS) {
      await expect(planWidget(page), `S8-3: the widget still shows the step "${text}" of the old plan.`).not.toContainText(text)
    }

    // One marker, at the point of the new plan: between the texts around it.
    await expect(planMarkers(page), `S8-3: the new plan must add exactly one "${UPDATED}" to the transcript.`).toHaveCount(1)
    await expect(transcript(page), `S8-3: "${UPDATED}" must show between "I change the approach." and "Now I follow the new plan.".`).toHaveText(
      inOrder('I change the approach.', UPDATED, 'Now I follow the new plan.')
    )
  })

  test('S8-4: a change of the step states only adds no "Updated the plan", also after a restart', async ({ chat }) => {
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
    await startSession(page, 'Plan the change', 'S8-4')

    // The text after the first plan shows, so the first plan has its place in the transcript.
    await reach(chat.control.waitForGate('progress-planned'), 'S8-4: the agent did not get the prompt, so it sent no plan.')
    await expectInTranscript(page, 'I made a plan.', 'S8-4: the text of the agent after the first plan does not show.')
    await expect(planMarkers(page), `S8-4 (spec, Flow, rule 5): the first plan of the session must show no "${UPDATED}".`).toHaveCount(0)
    await chat.control.open('progress-planned')

    // Two changes of the states of the same three steps. Neither is a new plan.
    await expectInTranscript(page, 'Step 2 is done.', 'S8-4: the text of the agent after the progress does not show.')
    await expectReady(page, 'S8-4')
    await expectPlan(page, 'Plan 2 of 3', finished, 'S8-4 (after the progress)')
    await expect(planMarkers(page), `S8-4: a change of the step states only must not add "${UPDATED}".`).toHaveCount(0)

    // After a restart, the saved entries show the same: progress is not a new plan.
    page = await restartAndOpen(chat, 'Plan the change', 'S8-4')
    await expectInTranscript(page, 'Step 2 is done.', 'S8-4: after a restart, the transcript does not show the turn.')
    await expect(
      planMarkers(page),
      `S8-4: after a restart, the transcript must still show no "${UPDATED}". The saved progress must not show as new plans.`
    ).toHaveCount(0)
  })

  test('S8-5: a plan with no steps clears the widget and shows "Updated the plan", also after a restart', async ({ chat }) => {
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
    await startSession(page, 'Plan the change', 'S8-5')

    // First the widget shows the plan.
    await reach(chat.control.waitForGate('clear-planned'), 'S8-5: the agent did not get the prompt, so it sent no plan.')
    await expectPlan(page, 'Plan 1 of 3', A11_PROGRESS, 'S8-5 (before it)')
    await chat.control.open('clear-planned')

    // Then the plan with no steps clears it. The transcript marks it, because it is not the first plan.
    await expectInTranscript(page, 'I cleared the plan.', 'S8-5: the text of the agent after the empty plan does not show.')
    await expectReady(page, 'S8-5')
    await expect(planWidget(page), 'S8-5: a plan with no steps must clear the plan widget, but the widget still shows.').toHaveCount(0)
    await expect(planMarkers(page), `S8-5 (spec, States): the empty plan must add exactly one "${UPDATED}", and the first plan none.`).toHaveCount(1)
    await expect(transcript(page), `S8-5: "${UPDATED}" must show before "I cleared the plan.".`).toHaveText(inOrder(UPDATED, 'I cleared the plan.'))

    // After a restart, the latest saved plan is empty, so no widget shows.
    page = await restartAndOpen(chat, 'Plan the change', 'S8-5')
    await expectInTranscript(page, 'I cleared the plan.', 'S8-5: after a restart, the transcript does not show the turn.')
    await expect(planWidget(page), 'S8-5: after a restart, the plan widget shows, but the latest plan has no steps.').toHaveCount(0)
    await expect(planMarkers(page), `S8-5: after a restart, the transcript must still show "${UPDATED}" once.`).toHaveCount(1)
  })
})
