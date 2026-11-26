// The acceptance tests: Playwright runs the built app (`npm run build`) with the simulated agent.
// Run them with `npm run acceptance`. The vitest config leaves `tests/acceptance` out.
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/acceptance',
  testMatch: '**/*.spec.ts',
  // Each test starts its own app, its own data folder and its own control pipe, but the tests
  // share the screen. One worker keeps the windows and the machine load steady.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: true,
  // A test ends when its checks pass or when this limit passes. No test sleeps.
  timeout: 60_000,
  // The upper limit of one auto-waiting check. A check ends as soon as it passes.
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: 'test-results'
})
