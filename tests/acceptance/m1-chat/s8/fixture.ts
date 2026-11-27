// The fixture of the S8 tests of milestone m1-chat: A11 and the "Plan widget" part of the brief.
//
// The setup is the S4 fixture: the built app in a temporary data folder, the simulated agent as
// `claude-code`, and the profile "Personal" from an old `workspace.json`. All data is fake.
// The simulated agent sends each plan with the step `{ do: 'update', update }` of S4: one ACP
// `session/update` of the kind `plan`, with all steps, as an ACP agent sends it.
//
// No test sleeps. A test waits on an auto-waiting check of Playwright, or on a report of the
// simulated agent through `reach`.
//
// The UI that these tests expect (S8 test contract). The S1 to S4 contracts stay.
// - The plan widget: an element with the role `region` and the name "Plan", in the session window.
//   It shows the latest plan of the session. It is not part of the log "Transcript".
// - Place: the widget is below the log "Transcript" and above the text field "Prompt". Later
//   entries of the transcript come above it. Other parts, such as the permission queue, can sit
//   between the widget and the composer.
// - Count: the widget shows "Plan <completed> of <all>", for example "Plan 1 of 3" for one
//   completed step of three. It shows the count also when it is folded.
// - Steps: one element with the role `list` in the widget, with one `listitem` for each step, in
//   the order of the agent. Each item shows the text of the step and its state as text:
//   "Pending", "In progress" or "Completed". The state text can be visually hidden.
// - Icons: pending shows an empty circle, in progress a spinner, completed a check. The tests
//   check only the spinner: the item in progress has a running animation, the others have none.
// - Fold: the widget has one button with `aria-expanded`. "true" shows the list. A click folds
//   the widget: `aria-expanded` is then "false" and the list is hidden. A second click unfolds it.
// - The widget stays after the turn ends, and after a restart it shows the same plan.
// - "Updated the plan": the transcript shows this exact text where a new plan replaced the old
//   one. A change of the states of the same steps is progress, not a new plan, and adds no such
//   text. The tests do not decide if the first plan of a session shows the text.
// - An empty plan (a plan update with no steps) clears the plan: the widget does not show, also
//   after a restart (test author reading, reported to the coordinator).
import { expect, type Locator, type Page } from '@playwright/test'
import { main, sessionEntry, transcript, promptField, type ChatApp } from '../s4/fixture'

export * from '../s4/fixture'

/** The states of a step of a plan, as ACP names them. */
export type StepState = 'pending' | 'in_progress' | 'completed'

/** The state text of each state in the widget. */
export const STATE_TEXT: Record<StepState, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed'
}

/** One step of a plan: its text and its state. No step text holds a state text. */
export type Step = readonly [text: string, state: StepState]

/** The `session/update` of a plan with these steps, as the step `update` of the simulated agent sends it. */
export function planUpdate(steps: readonly Step[]) {
  return {
    do: 'update',
    update: {
      sessionUpdate: 'plan',
      entries: steps.map(([content, status]) => ({ content, priority: 'medium', status }))
    }
  } as const
}

/** The three step texts of the plan of A11. */
export const A11_STEPS = ['Read the old module', 'Write the tests', 'Change the module'] as const

/** The plan of A11 as the agent first sends it: three steps, all pending. */
export const A11_FIRST: readonly Step[] = A11_STEPS.map((text) => [text, 'pending'] as const)

/** The plan of A11 after the progress: step 1 completed, step 2 in progress, step 3 pending. */
export const A11_PROGRESS: readonly Step[] = [
  [A11_STEPS[0], 'completed'],
  [A11_STEPS[1], 'in_progress'],
  [A11_STEPS[2], 'pending']
]

/** The exact text that marks a new plan in the transcript. */
export const UPDATED = 'Updated the plan'

export const planWidget = (page: Page) => main(page).getByRole('region', { name: 'Plan', exact: true })
export const planList = (page: Page) => planWidget(page).getByRole('list')
export const planSteps = (page: Page) => planList(page).getByRole('listitem')
export const planMarkers = (page: Page) => transcript(page).getByText(UPDATED, { exact: true })

/** True when the element or an element in it runs an animation, such as a spinner. */
async function animates(item: Locator): Promise<boolean> {
  return item.evaluate((element) => {
    // The test zone has no DOM types. The page runs this in Chromium.
    const animated = element as unknown as { getAnimations(options: { subtree: boolean }): { playState: string }[] }
    return animated.getAnimations({ subtree: true }).some((animation) => animation.playState === 'running')
  })
}

/** Checks that the widget shows this count and these steps, each with its state, in order. */
export async function expectPlan(page: Page, count: string, steps: readonly Step[], check: string): Promise<void> {
  const widget = planWidget(page)
  await expect(widget, `${check}: the session window has no region "Plan", so no plan widget shows.`).toBeVisible()
  await expect(widget, `${check}: the plan widget does not show the count "${count}".`).toContainText(count)
  await expect(planList(page), `${check}: the plan widget shows no list of steps.`).toBeVisible()
  await expect(planSteps(page), `${check}: the plan widget must show ${steps.length} steps.`).toHaveCount(steps.length)
  for (const [index, [text, state]] of steps.entries()) {
    const item = planSteps(page).nth(index)
    await expect(item, `${check}: step ${index + 1} of the plan widget must be "${text}".`).toContainText(text)
    await expect(item, `${check}: the step "${text}" must show the state "${STATE_TEXT[state]}".`).toContainText(STATE_TEXT[state])
    for (const other of Object.keys(STATE_TEXT) as StepState[]) {
      if (other === state) continue
      await expect(item, `${check}: the step "${text}" must not show the state "${STATE_TEXT[other]}".`).not.toContainText(STATE_TEXT[other])
    }
    await expect
      .poll(() => animates(item), {
        message:
          state === 'in_progress'
            ? `${check}: the step "${text}" in progress shows no spinner (no running animation).`
            : `${check}: the step "${text}" is ${STATE_TEXT[state].toLowerCase()}, but it shows a running animation.`
      })
      .toBe(state === 'in_progress')
  }
}

/** Checks that the widget sits below the log "Transcript", outside it, and above the text field "Prompt". */
export async function expectPinned(page: Page, check: string): Promise<void> {
  const widget = planWidget(page)
  await expect(widget, `${check}: the session window has no region "Plan", so no plan widget shows.`).toBeVisible()
  await expect(
    transcript(page).getByRole('region', { name: 'Plan', exact: true }),
    `${check}: the plan widget is inside the log "Transcript", so it is not pinned above the composer.`
  ).toHaveCount(0)
  const [box, log, prompt] = await Promise.all([widget.boundingBox(), transcript(page).boundingBox(), promptField(page).boundingBox()])
  if (!box || !log || !prompt) throw new Error(`${check}: the plan widget, the transcript or the text field "Prompt" has no box.`)
  // One pixel of rounding.
  expect(box.y + box.height, `${check}: the plan widget must end above the text field "Prompt" of the composer.`).toBeLessThanOrEqual(
    prompt.y + 1
  )
  expect(log.y + log.height, `${check}: the plan widget must start below the end of the transcript.`).toBeLessThanOrEqual(box.y + 1)
}

/** The button that folds and unfolds the widget: the one button with `aria-expanded` in it. */
export const foldButton = (page: Page, expanded: boolean) => planWidget(page).getByRole('button', { expanded })

/** Quits and starts Aether, and opens the session with this title. */
export async function restartAndOpen(chat: ChatApp, title: string, check: string): Promise<Page> {
  await chat.stop()
  const page = await chat.start()
  const entry = sessionEntry(page, title)
  await expect(entry, `${check}: after a restart, the sidebar does not list the session "${title}".`).toBeVisible()
  await entry.click()
  await expect(entry, `${check}: after a restart, the session "${title}" does not open.`).toHaveAttribute('aria-current', 'page')
  await expect(transcript(page), `${check}: after a restart, the session window has no log "Transcript".`).toBeVisible()
  return page
}
