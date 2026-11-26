import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The fixtures break rules on purpose. Worktrees and build output hold copies of tests.
    exclude: [...configDefaults.exclude, '.claude/**', 'out/**', 'tests/architecture/fixtures/**']
  }
})
