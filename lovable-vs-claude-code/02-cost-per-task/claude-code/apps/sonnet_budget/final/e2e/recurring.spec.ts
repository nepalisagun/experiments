import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'

const sizes = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 375, height: 700 },
]

const label = (p: Page) => p.getByTestId('month-label')
async function go(page: Page, dir: 'Previous' | 'Next', n: number) {
  for (let i = 0; i < n; i++) await page.getByRole('button', { name: `${dir} month` }).click()
}
async function goTo(page: Page, text: string) {
  for (let i = 0; i < 40 && (await label(page).innerText()) !== text; i++) {
    const cur = new Date(`1 ${await label(page).innerText()}`)
    const tgt = new Date(`1 ${text}`)
    await page.getByRole('button', { name: tgt < cur ? 'Previous month' : 'Next month' }).click()
  }
  await expect(label(page)).toHaveText(text)
}

for (const s of sizes) {
  test(`recurring @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height })
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    fs.mkdirSync('shots', { recursive: true })
    const rows = page.getByTestId('tx-row')
    const dlg = page.getByRole('dialog')
    const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

    // Add a monthly expense dated Jan 31 (from the month currently viewed)
    await goTo(page, 'January 2026')
    await page.getByRole('button', { name: '+ Add transaction' }).click()
    await expect(dlg.getByLabel('Repeat monthly')).not.toBeChecked()
    await dlg.getByLabel('Amount').fill('50')
    await dlg.getByLabel('Date').fill('2026-01-31')
    await dlg.getByLabel(/Note/).fill('Gym')
    await dlg.getByLabel('Repeat monthly').check()
    await page.screenshot({ path: `shots/${s.name}-repeat-dialog.png` })
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(rows).toHaveCount(1)
    await expect(rows.first().getByLabel('Recurring')).toBeVisible()

    // Later months get it automatically on the same day, clamped
    for (const [m, date] of [['February 2026', '2026-02-28'], ['March 2026', '2026-03-31'], ['April 2026', '2026-04-30']]) {
      await goTo(page, m)
      await expect(rows).toHaveCount(1)
      await expect(rows.first()).toContainText(date)
      await expect(rows.first()).toContainText('Gym')
      await expect(page.getByTestId('total-expenses')).toHaveText('50.00')
    }
    // Earlier month than the start has nothing
    await goTo(page, 'December 2025')
    await expect(rows).toHaveCount(0)

    // No duplicates when reopening, or after a reload
    await goTo(page, 'February 2026')
    await go(page, 'Next', 1)
    await go(page, 'Previous', 1)
    await expect(rows).toHaveCount(1)
    await page.reload()
    await goTo(page, 'February 2026')
    await expect(rows).toHaveCount(1)
    await expect(page.getByTestId('total-expenses')).toHaveText('50.00')

    // Leap year clamp (Feb 2028 -> 29th)
    await goTo(page, 'February 2028')
    await expect(rows.first()).toContainText('2028-02-29')

    // Recurring screen
    await page.getByRole('button', { name: 'Recurring', exact: true }).click()
    const rule = page.getByTestId('rule-row')
    await expect(rule).toHaveCount(1)
    await expect(rule).toContainText('Gym')
    await expect(rule).toContainText('Day 31 of each month')
    await expect(page.getByTestId('rule-status')).toHaveText('Active')
    await page.screenshot({ path: `shots/${s.name}-recurring.png` })
    expect(await noOverflow()).toBe(true)

    // Stop from March 2026
    await rule.getByLabel(/from month/).selectOption({ label: 'March 2026' })
    page.once('dialog', (d) => d.accept())
    await rule.getByRole('button', { name: /^Stop/ }).click()
    await expect(page.getByTestId('rule-status')).toHaveText('Stopped from March 2026. Earlier months are unchanged.')
    await page.screenshot({ path: `shots/${s.name}-recurring-stopped.png` })

    // Months before unchanged, from March on gone (also the one we opened before)
    await page.getByRole('button', { name: 'Month', exact: true }).click()
    await goTo(page, 'January 2026')
    await expect(rows).toHaveCount(1)
    await goTo(page, 'February 2026')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('2026-02-28')
    await goTo(page, 'March 2026')
    await expect(rows).toHaveCount(0)
    await goTo(page, 'April 2026')
    await expect(rows).toHaveCount(0)
    await goTo(page, 'August 2026')
    await expect(rows).toHaveCount(0)

    // Stop survives reload
    await page.reload()
    await page.getByRole('button', { name: 'Recurring', exact: true }).click()
    await expect(page.getByTestId('rule-status')).toContainText('Stopped from March 2026')

    // Edit path: repeating income from an existing plain transaction, then uncheck
    await page.getByRole('button', { name: 'Month', exact: true }).click()
    await goTo(page, 'June 2026')
    await page.getByRole('button', { name: '+ Add transaction' }).click()
    await dlg.getByRole('radio', { name: 'income' }).click()
    await dlg.getByLabel('Amount').fill('100.10')
    await dlg.getByLabel('Date').fill('2026-06-15')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(rows.first().getByLabel('Recurring')).toHaveCount(0)
    await page.getByRole('button', { name: /^Edit/ }).click()
    await dlg.getByLabel('Repeat monthly').check()
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(rows.first().getByLabel('Recurring')).toBeVisible()
    await goTo(page, 'July 2026')
    await expect(rows.first()).toContainText('2026-07-15')
    await expect(page.getByTestId('total-income')).toHaveText('100.10')
    // Edit the July occurrence: it shows as repeating; uncheck stops from August
    await page.getByRole('button', { name: /^Edit/ }).click()
    await expect(dlg.getByLabel('Repeat monthly')).toBeChecked()
    await dlg.getByLabel('Repeat monthly').uncheck()
    await dlg.getByRole('button', { name: 'Save' }).click()
    await goTo(page, 'August 2026')
    await expect(rows).toHaveCount(0)
    await goTo(page, 'June 2026')
    await expect(rows).toHaveCount(1)
    await page.getByRole('button', { name: 'Recurring', exact: true }).click()
    await expect(page.getByTestId('rule-row')).toHaveCount(2)
    await expect(page.getByTestId('rule-row').filter({ hasText: 'Stopped' })).toHaveCount(2)
    await page.setViewportSize({ width: s.width, height: s.height })
    expect(await noOverflow()).toBe(true)
  })
}
