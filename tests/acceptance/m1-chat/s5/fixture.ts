// The fixture of the S5 tests of milestone m1-chat: A4, A5 and the acceptance checks of S5 (spec
// `docs/milestones/m1-chat/stories/s5-permission-queue.md`, "Checks").
//
// The setup is the S4 fixture (through the S8 fixture): the built app in a temporary data folder, the
// simulated agent as `claude-code`, the fake `gh`, the profile "Personal" from an old
// `workspace.json`, and the check that the real data folder (`%APPDATA%\aether`) does not change.
// All data is fake. The product has no test hook.
//
// The simulated agent sends its permission requests and its form elicitations with the steps of
// `tests/simulated-agent/requests.mjs`. They do not wait for the answer, so two requests can be open
// at the same time. The agent reports each answer on its control pipe (`waitForPermission`,
// `waitForElicitation`). The default options of a request are "Allow" (`yes`, allow_once) and
// "Refuse" (`no`, reject_once).
//
// Two changes of the test to Electron, as `stubPickers` of S7 replaces a dialog. Neither is a hook
// of the product:
// - `holdAnswers` wraps the handler of the channel `aether:invoke` in the main process, so that a
//   call of one contract waits until the test releases it. With `optionId`, the held call goes on
//   with an option that no request offered, so the real main process refuses it (S5-27).
// - `resizeSession` lowers the minimum size of the window, and sizes it so that the session window
//   (the region `main`) is a given width (S5-26).
//
// `killApp` ends the main process of Aether as a crash does (S5-31): `electronApp.process().kill()`.
// The simulated agent and the Chromium helpers of the killed app stay alive on Windows, so it then
// ends the agent by the process ID that it reported, and each process whose command line names the
// temporary folder of the test. It then clears the fixture with `chat.stop()`, so `chat.start()`
// starts the app again on the same data folder.
//
// No test sleeps. A test waits on an auto-waiting check of Playwright, or on a report of the
// simulated agent through `reach`.
//
// The UI that these tests expect (S5 test contract, from the spec, "Accessibility and marking",
// "Decision cards", "The question card", "The answered card" and "Cards that closed without an
// answer"). The S1 to S4, S6, S7 and S8 contracts stay.
// - Place: each card shows inside the log "Transcript", at the place of its entry, where Claude
//   asked: tool A, card A, tool B, card B. The dock holds no card.
// - A decision card (a permission request): an `article` named exactly "Permission request". The
//   context (tool kind, tool title, locations) has the secondary color (`--muted`). The question
//   (for example "Run this command?" for `execute`, "Read this?" for `read`, "Approve the plan?"
//   for `switch_mode`) has the primary color (`--text`).
// - Its buttons: the options form an allow group and a refuse group. A group with one option is a
//   `button` named with the label of the agent. A group with more options is a split button: the
//   main part is a `button` named with the label of the recommended option, and the dropdown part is
//   a `button` named "More allow options" or "More refuse options", with `aria-haspopup="menu"`. It
//   opens a `menu` with one `menuitem` for each other option, named with its label.
// - The recommended option is first and primary (its background is `--fill`). It is the first
//   `allow-once` option, or on a safety ask (the first option of the agent is a refuse option) that
//   refuse option.
// - Answered: the card becomes an `article` named exactly "Permission answered", with no button. It
//   shows the question in the secondary color and the label of the chosen option in the primary color.
//   While the answer is sent, it keeps the name "Permission request", shows the answered layout with
//   a spinner and no button. When main refuses the answer, the card goes back to its buttons and shows
//   the error message in it.
// - Not answered: a "Permission answered" card (or a row of a "Claude asked" card) shows the reason
//   in the primary color: see `NOT_ANSWERED`.
// - A question card (a form elicitation): an `article` named exactly "Claude asks". A single select
//   is a `radiogroup` with one `radio` for each option, in the order of the agent, then the row
//   "Other". A multi select is a `group` with one `checkbox` for each option, then "Other". The name
//   of a row is the option label only; its explanation is its accessible description. "Other" holds
//   a text field named "Other". The buttons "Submit" and "Skip". No row is preselected. "Submit" is
//   disabled until a pick or a text. The refusal fallback has the two buttons "Keep the refusal"
//   (first, primary) and "Retry with <model>".
// - Answered question card: an `article` named exactly "Claude asked", with no button. One row for
//   each question: the question text (secondary), then the answer or the reason (primary).
// - Status line: "Waiting for your answer" while a card is open. With the log not at the bottom, it
//   also shows the button "Show request". A click brings the oldest open card into view and moves
//   the focus to it.
import { spawnSync } from 'node:child_process'
import { basename } from 'node:path'
import { expect, type Locator, type Page } from '@playwright/test'
import type { ChatApp } from '../s4/fixture'
import { main, transcript } from '../s4/fixture'
import { resolvedColor } from '../s8/frame'

export * from '../s8/fixture'
export { colorOf, isAtBottom, modelButton, nextFrames, resolvedColor, scrollFacts, wheelOver, linesOf } from '../s8/frame'
export { chooseMode, chooseModel, expectMode, invoke, MODE_LABELS, MODEL_IDS, paramsOf } from '../s7/fixture'

/** The texts of a card that closed without an answer (spec, "Cards that closed without an answer"). */
export const NOT_ANSWERED = {
  stopped: 'Not answered: you pressed Stop.',
  withdrawn: 'Not answered: Claude withdrew it.',
  exited: 'Not answered: Claude Code exited.',
  quit: 'Not answered: Aether closed.',
  interrupted: 'Not answered: Aether stopped unexpectedly.',
  skipped: 'Not answered: you skipped it.'
} as const

/** The question text of a decision card for each tool kind that the tests use (spec, "Decision cards"). */
export const QUESTION_OF = {
  execute: 'Run this command?',
  edit: 'Make this change?',
  read: 'Read this?',
  switch_mode: 'Approve the plan?'
} as const

export const WAITING = 'Waiting for your answer'

// The cards.

export const openDecisions = (page: Page) => transcript(page).getByRole('article', { name: 'Permission request', exact: true })
export const answeredDecisions = (page: Page) => transcript(page).getByRole('article', { name: 'Permission answered', exact: true })
export const openQuestions = (page: Page) => transcript(page).getByRole('article', { name: 'Claude asks', exact: true })
export const answeredQuestions = (page: Page) => transcript(page).getByRole('article', { name: 'Claude asked', exact: true })
/** Every card of the session window, in the log or not. */
export const allCards = (page: Page) => main(page).getByRole('article')

/** The open decision card that shows this tool title. */
export const openDecision = (page: Page, title: string) => openDecisions(page).filter({ hasText: title })

export const buttonIn = (card: Locator, name: string) => card.getByRole('button', { name, exact: true })
export const waitingStatus = (page: Page) => main(page).getByText(WAITING, { exact: true })
export const showRequest = (page: Page) => main(page).getByRole('button', { name: 'Show request', exact: true })

/** The names of the buttons of a card, in the order of the page. */
export async function buttonNames(card: Locator): Promise<string[]> {
  const names: string[] = []
  for (const button of await card.getByRole('button').all()) {
    names.push(((await button.getAttribute('aria-label')) ?? (await button.innerText())).trim())
  }
  return names
}

/** The computed background color of an element. */
export function backgroundOf(locator: Locator): Promise<string> {
  return locator.evaluate((element) => {
    const win = globalThis as unknown as { getComputedStyle(node: unknown): { backgroundColor: string } }
    return win.getComputedStyle(element).backgroundColor
  })
}

/** Checks that the button is primary: its background is the fill color of the app (`--fill`). */
export async function expectPrimary(page: Page, button: Locator, primary: boolean, message: string): Promise<void> {
  const fill = await resolvedColor(page, 'var(--fill)')
  await expect(button, message).toBeVisible()
  await expect.poll(async () => (await backgroundOf(button)) === fill, { message }).toBe(primary)
}

/** True when the element or an element in it runs an animation, such as a spinner. */
export function animates(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const animated = element as unknown as { getAnimations(options: { subtree: boolean }): { playState: string }[] }
    return animated.getAnimations({ subtree: true }).some((animation) => animation.playState === 'running')
  })
}

/** True when the element holds the keyboard focus, or an element in it does. */
export function holdsFocus(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const node = element as unknown as { contains(other: unknown): boolean; ownerDocument: { activeElement: unknown } }
    return node.contains(node.ownerDocument.activeElement)
  })
}

/** The top of an element in the page, for a check of the order. */
export async function topOf(locator: Locator, what: string): Promise<number> {
  const box = await locator.boundingBox()
  if (!box) throw new Error(`${what} has no box.`)
  return box.y
}

// Requests of the simulated agent.

/** One permission request of the step `ask`. */
export interface Ask {
  id: string
  title: string
  kind?: string
  locations?: string[]
  options?: { optionId: string; name: string; kind: string }[]
  modes?: Record<string, string>
}

/** The two requests of A4 and A5: a shell command and a read, each with "Allow" and "Refuse". */
export const TWO_REQUESTS: Ask[] = [
  { id: 'run-tests', title: 'npm test', kind: 'execute' },
  { id: 'read-log', title: 'Read last-run.txt', kind: 'read', locations: ['C:\\work\\logs\\last-run.txt'] }
]

/** The options of a shell command in Claude Code: "Yes", the "always" option, and "No". */
export const SHELL_OPTIONS = [
  { optionId: 'allow', name: 'Yes', kind: 'allow_once' },
  { optionId: 'allow-always', name: "Yes, and don't ask again for npm test commands", kind: 'allow_always' },
  { optionId: 'reject', name: 'No', kind: 'reject_once' }
]

/** The options of the plan exit of Claude Code, when the session has no auto mode and no bypass. */
export const PLAN_EXIT_OPTIONS = [
  { optionId: 'exit-plan-accept-edits', name: 'Yes, auto-accept edits', kind: 'allow_always' },
  { optionId: 'exit-plan-default', name: 'Yes, manually approve edits', kind: 'allow_once' },
  { optionId: 'reject', name: 'No, keep planning', kind: 'reject_once' }
]

export const ask = (...requests: Ask[]) => ({ do: 'ask', requests }) as const
export const answers = { do: 'answers' } as const
export const gate = (name: string) => ({ do: 'gate', name }) as const
export const say = (text: string) => ({ do: 'say', text }) as const

/** A form elicitation of the step `elicit`. `request` holds the ACP parameters without the session ID. */
export const elicit = (id: string, request: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ do: 'elicit', id, request: { mode: 'form', ...request }, ...extra }) as const

/** One option of a question of AskUserQuestion: the label is the `const` and the title, as the adapter sends it. */
export interface Choice {
  label: string
  description?: string
}

const enumOption = ({ label, description }: Choice) => ({ const: label, title: label, ...(description ? { description } : {}) })

/** The two fields of one AskUserQuestion question, as the adapter builds them (`elicitation.js`). */
export function questionFields(index: number, question: { header?: string; text?: string; multi?: boolean; options: Choice[] }) {
  const options = question.options.map(enumOption)
  const base = { ...(question.header ? { title: question.header } : {}), ...(question.text ? { description: question.text } : {}) }
  return {
    [`question_${index}`]: question.multi ? { type: 'array', ...base, items: { anyOf: options } } : { type: 'string', ...base, oneOf: options },
    [`question_${index}_custom`]: {
      type: 'string',
      title: 'Other',
      description: question.multi
        ? 'Type your own answer to add to your selection above (optional).'
        : 'Type your own answer, or add a note to the option you chose above (optional).'
    }
  }
}

/** The request of AskUserQuestion with one question: the question is the message (`elicitation.js`). */
export function askOneQuestion(toolCallId: string, question: { header?: string; text: string; multi?: boolean; options: Choice[] }) {
  return {
    toolCallId,
    message: question.text,
    requestedSchema: { type: 'object', properties: questionFields(0, { header: question.header, multi: question.multi, options: question.options }) }
  }
}

/** The request of AskUserQuestion with several questions: each field description holds its question. */
export function askQuestions(toolCallId: string, questions: { header?: string; text: string; multi?: boolean; options: Choice[] }[]) {
  const properties = Object.assign({}, ...questions.map((question, index) => questionFields(index, question))) as Record<string, unknown>
  return { toolCallId, message: 'Please answer the following questions.', requestedSchema: { type: 'object', properties } }
}

/** The tool call of AskUserQuestion that comes before its elicitation. */
export const askUserQuestionTool = (id: string) =>
  ({ do: 'update', update: { sessionUpdate: 'tool_call', toolCallId: id, title: 'AskUserQuestion', kind: 'other', status: 'pending' } }) as const

// The main process and the window.

interface HeldGlobal {
  __s5Hold?: { contract: string; optionId: string | null; held: (() => void)[]; calls: number }
}

/**
 * Holds each call of the contract `contract` in the main process until `releaseAnswers`. With
 * `optionId`, the held call goes on with that option, so the main process refuses an option that
 * no request offered. Call it again with other values to change the hold. `stopHolding` ends it.
 */
export async function holdAnswers(chat: ChatApp, contract: string, optionId: string | null = null): Promise<void> {
  const installed = await chat.app.evaluate(
    ({ ipcMain }, hold) => {
      const store = globalThis as unknown as HeldGlobal & { __s5Original?: (...args: unknown[]) => unknown }
      const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, (...args: unknown[]) => unknown> })._invokeHandlers
      if (!handlers?.has('aether:invoke')) return false
      store.__s5Hold = { contract: hold.contract, optionId: hold.optionId, held: [], calls: 0 }
      if (!store.__s5Original) {
        const original = handlers.get('aether:invoke')!
        store.__s5Original = original
        handlers.set('aether:invoke', async (event: unknown, name: unknown, input: unknown) => {
          const current = store.__s5Hold
          if (!current || name !== current.contract) return original(event, name, input)
          current.calls += 1
          await new Promise<void>((resolve) => current.held.push(resolve))
          const changed = current.optionId !== null && typeof input === 'object' && input !== null ? { ...input, optionId: current.optionId } : input
          return original(event, name, changed)
        })
      }
      return true
    },
    { contract, optionId }
  )
  if (!installed) throw new Error('The main process has no handler of the channel aether:invoke, so the test cannot hold an answer.')
}

/** The number of calls that the hold took so far. */
export const heldCalls = (chat: ChatApp) =>
  chat.app.evaluate(() => (globalThis as unknown as HeldGlobal).__s5Hold?.calls ?? 0)

/** Lets each held call go on. */
export async function releaseAnswers(chat: ChatApp): Promise<void> {
  await chat.app.evaluate(() => {
    const hold = (globalThis as unknown as HeldGlobal).__s5Hold
    for (const release of hold?.held.splice(0) ?? []) release()
  })
}

/** Ends the hold. Later calls go to the main process at once. */
export async function stopHolding(chat: ChatApp): Promise<void> {
  await releaseAnswers(chat)
  await chat.app.evaluate(() => {
    delete (globalThis as unknown as HeldGlobal).__s5Hold
  })
}

/** Sizes the window so that the session window (the region `main`) is `width` pixels wide. */
export async function resizeSession(chat: ChatApp, page: Page, width: number): Promise<void> {
  const box = await main(page).boundingBox()
  if (!box) throw new Error('The session window has no box.')
  const content = Math.round(box.x + width)
  await chat.app.evaluate(
    ({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) throw new Error('The app has no window.')
      win.setMinimumSize(200, 300)
      win.setContentSize(size, 760)
    },
    content
  )
  await expect.poll(async () => Math.round((await main(page).boundingBox())?.width ?? 0), { message: `The session window does not become ${width} px wide.` }).toBe(width)
}

/** Whether a process runs. Signal 0 only checks it. */
export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** The IDs of the processes whose command line names the temporary folder of the test, without this test process. */
function processesOfTest(chat: ChatApp): number[] {
  const name = basename(chat.root)
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${name}*' -and $_.ProcessId -ne $PID } | ForEach-Object { $_.ProcessId }`
  const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true })
  if (run.error || run.status !== 0) throw new Error(`The process list failed: ${run.error?.message ?? run.stderr}`)
  return run.stdout
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
}

/**
 * Kills the main process of Aether, as a crash does. Then it ends the simulated agent by the process
 * ID that it reported, and the helpers of the killed app, and clears the fixture. The data folder
 * stays as the kill left it.
 */
export async function killApp(chat: ChatApp): Promise<void> {
  const app = chat.app.process()
  const exited = new Promise<void>((resolve) => {
    if (app.exitCode !== null || app.signalCode !== null) resolve()
    else app.once('exit', () => resolve())
  })
  app.kill()
  await exited
  for (const pid of chat.control.pids) if (isRunning(pid)) process.kill(pid)
  for (const pid of processesOfTest(chat)) if (isRunning(pid)) process.kill(pid)
  await expect.poll(() => chat.control.pids.filter(isRunning), { message: 'An agent process still runs after the kill of Aether.' }).toEqual([])
  await chat.stop()
}

/** The saved `answers` entries of the database, in the order of the session: the JSON of each row. */
export function answersEntries(data: { rowsOf(table: string): { values: Record<string, unknown> }[] }): Record<string, unknown>[] {
  return data
    .rowsOf('entries')
    .filter((row) => row.values.kind === 'answers')
    .sort((a, b) => Number(a.values.position) - Number(b.values.position))
    .map((row) => JSON.parse(String(row.values.data)) as Record<string, unknown>)
}
