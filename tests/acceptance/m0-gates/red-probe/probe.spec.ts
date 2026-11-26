// RED PROBE (G14): a test that this story locks. Do not merge.
import { expect, test } from '@playwright/test'

test('red probe: a locked test of the story', () => {
  expect(1).toBe(1)
})
