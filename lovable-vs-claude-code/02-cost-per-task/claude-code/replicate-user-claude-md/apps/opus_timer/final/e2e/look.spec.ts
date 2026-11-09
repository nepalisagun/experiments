import { expect, test } from '@playwright/test'

// Visual check only: screenshots of a running focus session and a settled break for manual review.
test('screenshots for visual review', async ({ page }, info) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/ - /)
  await page.getByLabel('Working on').fill('Draft the quarterly plan')
  await page.getByRole('button', { name: 'Start' }).click()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `shots/${info.project.name}-running.png`, fullPage: true })
  await page.getByRole('button', { name: 'Skip' }).click()
  await page.waitForTimeout(1000) // let the background colour transition settle
  await page.screenshot({ path: `shots/${info.project.name}-short-settled.png`, fullPage: true })
})
