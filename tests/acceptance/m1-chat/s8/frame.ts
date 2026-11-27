// The helpers of the S8 tests of the session frame, the composer, the model button and the failed turn.
//
// The setup is the S8 fixture (`./fixture.ts`), which is the S4 fixture. All data is fake. The
// product has no test hook. No helper sleeps: a wait is an auto-waiting check of Playwright, a poll,
// or a wait for the next animation frames of the window.
//
// The UI that these tests expect (spec `s8-plan-widget.md`). The S1 to S4, S7 and A11 contracts stay.
// - Frame: the session window is a fixed frame. The header is at the top, the log "Transcript" is
//   the only scroll area, and the bottom dock is always in view.
// - The log "Transcript" is the scroll element itself (overflow-y auto or scroll). No element
//   around it scrolls, and the page does not scroll.
// - The dock never scrolls: no element around the text field "Prompt" scrolls or has a scroll
//   offset. Only the list of the plan widget can scroll, inside the widget. "Prompt" and "Send"
//   stay fully in view. The log keeps a height above zero, also with a tall dock.
// - Follow: while the log is at the bottom, it stays at the bottom when new entries and streamed
//   text come. When the user scrolled up, the log keeps the position. When the user scrolls back to
//   the bottom, it follows again.
// - Header: the title (the heading of level 1) and the button "Delete session", nothing else. No
//   facts row: no "Profile", no "Folder", no folder path.
// - Composer: "Prompt" is a `<textarea>` with the placeholder "Reply to Claude". It is at least
//   2 lines high. It grows with its content up to 8 lines (`COMPOSER_MAX_LINES`), then it scrolls
//   inside. A control row sits inside the rounded box, below the text: at the left "Add context",
//   "Mode" and the model button, in this order, and at the right "Send" (or "Stop"). "Add context"
//   is disabled, and its description says "Coming soon". No mic button. No row below the box.
// - The model button: the button named exactly "Model", as in the composer of a new session (S7
//   contract, `SessionComposer.tsx` 341). Its text is the label of the model of the session. It
//   opens the `group` "Model". In a draft it is enabled, and a choice saves the model with
//   `sessions.set-model`. After the first message it is disabled.
// - `sessions.set-model`: input `{ id, model }`. After the first message it answers the error
//   `session-started`, and the saved model stays.
// - A failed turn: one element with the role `alert` inside the log, with the exit code as
//   "exit code <n>". Its text has the muted color (`--muted`, not `--danger`). It has an icon with
//   `aria-hidden="true"`. The last log lines are in a `<details>` inside the alert, with the
//   summary "Show log". The fold-out is closed at first.
import { expect, type Locator, type Page } from '@playwright/test'
import { main } from './fixture'

/** The highest number of lines of "Prompt" before it scrolls inside (spec, `COMPOSER_MAX_LINES`). */
export const COMPOSER_MAX_LINES = 8

/** A text of `count` lines, each one named by its number and the label. */
export const linesOf = (count: number, label: string) =>
  Array.from({ length: count }, (_, index) => `Line ${index + 1} of ${label}.`).join('\n')

// The functions below run in the window of the renderer. The test zone has no DOM types, so each
// one names the few members it reads.
interface DomNode {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  tagName: string
  className: unknown
  parentElement: DomNode | null
  getAttribute(name: string): string | null
  querySelectorAll(selector: string): ArrayLike<DomNode>
}
interface DomWindow {
  getComputedStyle(node: DomNode): { overflowY: string; color: string }
  requestAnimationFrame(callback: () => void): number
  document: { scrollingElement: DomNode | null; body: DomNode & { append(node: DomNode): void }; createElement(tag: string): DomNode & { style: { color: string }; remove(): void } }
}

/** The scroll facts of an element: its offset, its full height, its visible height and its overflow. */
export function scrollFacts(locator: Locator) {
  return locator.evaluate((element) => {
    const node = element as unknown as DomNode
    const win = globalThis as unknown as DomWindow
    return { scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, overflowY: win.getComputedStyle(node).overflowY }
  })
}

/** True when the element shows the end of its content. One pixel of rounding. */
export async function isAtBottom(locator: Locator): Promise<boolean> {
  const { scrollTop, scrollHeight, clientHeight } = await scrollFacts(locator)
  return scrollTop + clientHeight >= scrollHeight - 2
}

/**
 * The elements around this element that scroll: each ancestor with a scroll offset, or with an
 * overflow that scrolls and more content than room. The page counts when the document scrolls.
 */
export function scrollersAround(locator: Locator): Promise<string[]> {
  return locator.evaluate((element) => {
    const win = globalThis as unknown as DomWindow
    const root = win.document.scrollingElement
    const name = (node: DomNode) => {
      const role = node.getAttribute('role')
      const label = node.getAttribute('aria-label')
      const classes = typeof node.className === 'string' && node.className !== '' ? `.${node.className.trim().split(/\s+/).join('.')}` : ''
      return `${node.tagName.toLowerCase()}${classes}${role ? `[role=${role}]` : ''}${label ? `[aria-label=${label}]` : ''}`
    }
    const found: string[] = []
    for (let node = (element as unknown as DomNode).parentElement; node; node = node.parentElement) {
      if (node === root) continue
      const overflow = win.getComputedStyle(node).overflowY
      const scrolls = /auto|scroll|overlay/.test(overflow) && node.scrollHeight > node.clientHeight + 1
      if (node.scrollTop > 0 || scrolls) found.push(`${name(node)} (scrollTop ${node.scrollTop}, content ${node.scrollHeight}px in ${node.clientHeight}px)`)
    }
    if (root && (root.scrollTop > 0 || root.scrollHeight > root.clientHeight + 1)) {
      found.push(`the page (scrollTop ${root.scrollTop}, content ${root.scrollHeight}px in ${root.clientHeight}px)`)
    }
    return found
  })
}

/** True when the element or an element in it scrolls: an overflow that scrolls, and more content than room. */
export function scrollsInside(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const win = globalThis as unknown as DomWindow
    const node = element as unknown as DomNode
    const all = [node, ...Array.from(node.querySelectorAll('*'))]
    return all.some((item) => /auto|scroll|overlay/.test(win.getComputedStyle(item).overflowY) && item.scrollHeight > item.clientHeight + 1)
  })
}

/** Waits for the next animation frames of the window, so that the effects of a render have run. */
export async function nextFrames(page: Page, count = 3): Promise<void> {
  await page.evaluate(async (frames) => {
    const win = globalThis as unknown as DomWindow
    for (let index = 0; index < frames; index += 1) await new Promise<void>((resolve) => win.requestAnimationFrame(() => resolve()))
  }, count)
}

/** Turns the mouse wheel over the middle of the element, as a user scrolls. It does not click or hover an entry. */
export async function wheelOver(page: Page, locator: Locator, deltaY: number, check: string): Promise<void> {
  const box = await locator.boundingBox()
  if (!box) throw new Error(`${check}: the element to scroll has no box.`)
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 40))
  await page.mouse.wheel(0, deltaY)
}

/** The computed color of a CSS value, for example `var(--muted)`, as the window resolves it. */
export function resolvedColor(page: Page, value: string): Promise<string> {
  return page.evaluate((color) => {
    const win = globalThis as unknown as DomWindow
    const probe = win.document.createElement('span')
    probe.style.color = color
    win.document.body.append(probe)
    const resolved = win.getComputedStyle(probe).color
    probe.remove()
    return resolved
  }, value)
}

/** The computed text color of an element. */
export function colorOf(locator: Locator): Promise<string> {
  return locator.evaluate((element) => (globalThis as unknown as DomWindow).getComputedStyle(element as unknown as DomNode).color)
}

/** The model button of the composer of the session window. */
export const modelButton = (page: Page) => main(page).getByRole('button', { name: 'Model', exact: true })

/** The height of the text field, in pixels. */
export async function heightOf(locator: Locator, check: string): Promise<number> {
  const box = await locator.boundingBox()
  if (!box) throw new Error(`${check}: the text field "Prompt" has no box.`)
  return box.height
}

/** True when the text field shows all its text: no inner scroll. One pixel of rounding. */
export async function fitsInside(locator: Locator): Promise<boolean> {
  const { scrollHeight, clientHeight } = await scrollFacts(locator)
  return scrollHeight <= clientHeight + 1
}

/** Checks that the text field "Prompt" and the button "Send" are fully in the window. */
export async function expectComposerInView(prompt: Locator, send: Locator, check: string): Promise<void> {
  await expect(prompt, `${check}: the text field "Prompt" is not fully in view. The dock must stay in view.`).toBeInViewport({ ratio: 1 })
  await expect(send, `${check}: the button "Send" is not fully in view. The dock must stay in view.`).toBeInViewport({ ratio: 1 })
}
