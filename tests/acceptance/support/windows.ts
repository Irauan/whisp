// The window arguments of each acceptance launch: the app windows stay hidden and never take the focus.
// Decision 0009 holds: the product has no test hook. Electron loads `hidden-windows.cjs` with `-r`.
// Playwright removes NODE_OPTIONS from the app environment, so the script goes in the arguments.
// The agent processes do not inherit an argument, so their environment does not change.
// Set AETHER_TEST_SHOW_WINDOWS=1 to show the windows, for debugging.
import { join } from 'node:path'

const HIDDEN_WINDOWS = join(__dirname, 'hidden-windows.cjs')

/** The launch arguments `args`, with the script that hides the windows first. */
export function windowArgs(args: string[]): string[] {
  if (process.env.AETHER_TEST_SHOW_WINDOWS === '1') return args
  return ['-r', HIDDEN_WINDOWS, ...args]
}
