// A19 of milestone m1-chat, on the built app: Projects and Work items show "Coming soon".
//
// The app starts with an old profile: one project, one work item and one session draft.
// Decision 0005 removes projects and work items, so the old ones must not show.
// No test sleeps. Each wait is an auto-waiting check of Playwright.
import type { Page } from '@playwright/test'
import { expect, ITEM_TITLE, PROJECT_NAME, SESSION_TITLE, test } from './fixture'

const COMING_SOON = /coming soon/i

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Main' })

/** The sidebar entry of a page. Its name starts with the label, and its tag follows. */
const entry = (page: Page, label: string) =>
  sidebar(page).getByRole('button', { name: new RegExp(`^${label}`) })

/** Waits until the app shows the old profile. The session draft is the proof that it loaded. */
async function profileLoaded(page: Page): Promise<void> {
  await expect(sidebar(page).getByText(SESSION_TITLE)).toBeVisible()
}

/** Checks that the window shows neither the old project nor the old work item. */
async function noOldData(page: Page): Promise<void> {
  await expect(page.getByText(PROJECT_NAME)).toHaveCount(0)
  await expect(page.getByText(ITEM_TITLE)).toHaveCount(0)
}

/** Opens the entry, and checks that its page is open and shows "Coming soon". */
async function openComingSoon(page: Page, label: string): Promise<void> {
  const link = entry(page, label)
  await expect(link, `The sidebar has no entry "${label}".`).toBeVisible()
  await expect(link).toContainText(COMING_SOON)
  await link.click()
  await expect(link).toHaveAttribute('aria-current', 'page')
  await expect(
    page.getByRole('main').getByText(COMING_SOON).first(),
    `The page "${label}" does not show "Coming soon".`
  ).toBeVisible()
}

test.describe('A19: Projects and Work items show "Coming soon"', () => {
  test('A19: the sidebar entry Projects shows "Coming soon", and its page shows "Coming soon"', async ({
    aether: { page }
  }) => {
    await profileLoaded(page)
    await openComingSoon(page, 'Projects')
  })

  test('A19: the sidebar entry Work items shows "Coming soon", and its page shows "Coming soon"', async ({
    aether: { page }
  }) => {
    await profileLoaded(page)
    await openComingSoon(page, 'Work items')
  })

  test('A19: the project and the work item of an old profile do not show', async ({ aether: { page } }) => {
    await profileLoaded(page)

    // The first window: the sidebar and the home page.
    await noOldData(page)

    // The pages of Work items and Projects.
    await openComingSoon(page, 'Work items')
    await noOldData(page)
    await openComingSoon(page, 'Projects')
    await noOldData(page)

    // The search lists neither.
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible()
    await noOldData(page)
  })
})
