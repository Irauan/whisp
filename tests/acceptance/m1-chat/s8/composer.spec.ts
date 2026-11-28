// The composer of the session window, story S8 of milestone m1-chat, on the built app.
//
// Spec, "The composer" (user decision, 2026-11-27): the composer follows the composer of the
// GitHub app.
// - It is one rounded box. The text area "Prompt" is at least 2 lines high, with the placeholder
//   "Reply to Claude". It grows with its content up to `COMPOSER_MAX_LINES` (8) lines, then it
//   scrolls inside.
// - A control row sits inside the box, at its bottom: at the left "Add context" (disabled, "Coming
//   soon"), the Mode control and the model button, in this order; at the right "Send".
// - No mic button: voice input is outside m1 (brief, Non-goals). No row below the box.
// - "Prompt" stays a `<textarea>`.
//
// The test measures the heights of "Prompt" and compares them. It does not assume a line height.
// `frame.ts` describes the UI contract. No test sleeps.
import type { Locator } from '@playwright/test'
import { DRAFT_IN_REPO_A, expect, expectInTranscript, main, promptField, sendButton, startImported, startSession, stopButton, test, writeOldProfile } from './fixture'
import { COMPOSER_MAX_LINES, fitsInside, heightOf, linesOf, modelButton } from './frame'

test.describe('S8 composer', () => {
  test('Composer: "Prompt" grows from 2 lines up to 8 lines and then scrolls inside, "Add context" is disabled, no mic, and the controls sit in a row inside the box', async ({
    chat
  }) => {
    const check = 'S8 composer'
    await chat.control.scenario('text', { chunks: ['Hello ', 'from the agent.'] })
    await writeOldProfile(chat, [DRAFT_IN_REPO_A])
    const page = await startImported(chat)
    await startSession(page, 'Say hello', check)
    await expectInTranscript(page, 'Hello from the agent.', `${check}: the reply does not show.`)
    await expect(stopButton(page), `${check}: the turn does not end.`).toHaveCount(0)

    const prompt = promptField(page)
    await expect(prompt, `${check}: the session window has no text field "Prompt".`).toBeEditable()
    expect(await prompt.evaluate((element) => (element as unknown as { tagName: string }).tagName), `${check}: "Prompt" must stay a <textarea>.`).toBe(
      'TEXTAREA'
    )

    // At least 2 lines: the empty field, 1 line and 2 lines have the same height. 3 lines grow it.
    await prompt.fill('')
    const empty = await heightOf(prompt, check)
    await prompt.fill(linesOf(3, 'the message'))
    await expect
      .poll(() => heightOf(prompt, check), { message: `${check}: "Prompt" does not grow with its content: 3 lines must be taller than the empty field of 2 lines.` })
      .toBeGreaterThan(empty + 1)
    const three = await heightOf(prompt, check)
    const line = three - empty
    for (const count of [2, 1]) {
      await prompt.fill(linesOf(count, 'the message'))
      await expect
        .poll(async () => Math.abs((await heightOf(prompt, check)) - empty), {
          message: `${check}: "Prompt" must be at least 2 lines high: with ${count} line(s), it must keep the height of the empty field (${empty}px).`
        })
        .toBeLessThanOrEqual(1)
      expect(await fitsInside(prompt), `${check}: with ${count} line(s), "Prompt" must show all its text without a scroll.`).toBe(true)
    }

    // It grows one line at a time up to 8 lines.
    await prompt.fill(linesOf(COMPOSER_MAX_LINES, 'the message'))
    const expected = empty + (COMPOSER_MAX_LINES - 2) * line
    await expect
      .poll(async () => Math.abs((await heightOf(prompt, check)) - expected), {
        message: `${check}: with ${COMPOSER_MAX_LINES} lines, "Prompt" must be ${COMPOSER_MAX_LINES - 2} lines taller than the field of 2 lines (about ${Math.round(expected)}px).`
      })
      .toBeLessThanOrEqual(2)
    expect(await fitsInside(prompt), `${check}: with ${COMPOSER_MAX_LINES} lines, "Prompt" must show all its text without a scroll.`).toBe(true)
    const highest = await heightOf(prompt, check)

    // Above 8 lines, it stops growing and scrolls inside.
    for (const count of [COMPOSER_MAX_LINES + 1, 20]) {
      await prompt.fill(linesOf(count, 'the message'))
      await expect
        .poll(() => fitsInside(prompt), { message: `${check}: with ${count} lines, "Prompt" must scroll inside, above ${COMPOSER_MAX_LINES} lines.` })
        .toBe(false)
      expect(
        Math.abs((await heightOf(prompt, check)) - highest),
        `${check}: with ${count} lines, "Prompt" must keep the height of ${COMPOSER_MAX_LINES} lines (${highest}px).`
      ).toBeLessThanOrEqual(1)
    }
    await prompt.fill('')
    await expect(prompt, `${check}: the empty "Prompt" must show the placeholder "Reply to Claude".`).toHaveAttribute('placeholder', 'Reply to Claude')

    // "Add context" is disabled, and it says "Coming soon".
    const add = main(page).getByRole('button', { name: 'Add context', exact: true })
    await expect(add, `${check}: the composer has no button "Add context".`).toBeVisible()
    await expect(add, `${check}: "Add context" must be disabled: a running session takes no new attachment in m1.`).toBeDisabled()
    await expect(add, `${check}: "Add context" must say "Coming soon".`).toHaveAccessibleDescription(/coming soon/i)

    // No mic.
    await expect(main(page).getByRole('button', { name: /voice|mic/i }), `${check}: the composer must have no mic button.`).toHaveCount(0)

    // The control row: "Add context", "Mode", the model button, then "Send" at the right, in one row below the text.
    const mode = main(page).getByRole('button', { name: 'Mode', exact: true })
    const model = modelButton(page)
    await expect(mode, `${check}: the composer has no button "Mode".`).toBeVisible()
    await expect(model, `${check}: the composer has no model button "Model".`).toBeVisible()
    await expect(model, `${check}: the model button must show the model of the session, "Default".`).toHaveText('Default')
    await expect(sendButton(page), `${check}: the composer has no button "Send".`).toBeVisible()
    const boxOf = async (control: Locator, name: string) => {
      const box = await control.boundingBox()
      if (!box) throw new Error(`${check}: "${name}" of the composer has no box.`)
      return box
    }
    const field = await boxOf(prompt, 'Prompt')
    const addBox = await boxOf(add, 'Add context')
    const modeBox = await boxOf(mode, 'Mode')
    const modelBox = await boxOf(model, 'Model')
    const sendBox = await boxOf(sendButton(page), 'Send')
    expect(addBox.x, `${check}: "Mode" must come after "Add context", at the left.`).toBeLessThan(modeBox.x)
    expect(modeBox.x, `${check}: the model button must come after "Mode".`).toBeLessThan(modelBox.x)
    expect(modelBox.x + modelBox.width, `${check}: "Send" must sit at the right, after the model button.`).toBeLessThan(sendBox.x)
    for (const [name, box] of [['Add context', addBox], ['Mode', modeBox], ['Model', modelBox], ['Send', sendBox]] as const) {
      expect(box.y, `${check}: "${name}" must sit in the control row below the text of "Prompt".`).toBeGreaterThanOrEqual(field.y + field.height - 1)
      expect(Math.abs(box.y + box.height / 2 - (sendBox.y + sendBox.height / 2)), `${check}: "${name}" must sit in one row with "Send".`).toBeLessThanOrEqual(6)
    }

    // The row is inside the rounded box of "Prompt", and no row comes below the box.
    const inBox = await prompt.evaluate((element) => {
      interface Item {
        parentElement: Item | null
        contains(other: Item): boolean
        querySelectorAll(selector: string): ArrayLike<Item>
        getAttribute(name: string): string | null
      }
      const win = globalThis as unknown as { getComputedStyle(item: Item): { borderTopWidth: string; borderTopLeftRadius: string } }
      let box = (element as unknown as Item).parentElement
      while (box && (win.getComputedStyle(box).borderTopWidth === '0px' || win.getComputedStyle(box).borderTopLeftRadius === '0px')) box = box.parentElement
      if (!box) return []
      return Array.from(box.querySelectorAll('button')).map((button) => button.getAttribute('aria-label') ?? '')
    })
    for (const name of ['Add context', 'Mode', 'Model', 'Send']) {
      expect(inBox, `${check}: "${name}" must sit inside the rounded box of "Prompt".`).toContain(name)
    }
    const below: string[] = []
    for (const button of await main(page).getByRole('button').filter({ visible: true }).all()) {
      const box = await button.boundingBox()
      if (box && box.y >= sendBox.y + sendBox.height + 1) below.push((await button.getAttribute('aria-label')) ?? (await button.innerText()))
    }
    expect(below, `${check}: the session window must have no row below the box of the composer.`).toEqual([])
  })
})
