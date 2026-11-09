import { expect, test, type Page } from '@playwright/test'

const sizes = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 375, height: 800 },
]

async function goTo(page: Page, label: string) {
  const target = Date.parse('1 ' + label)
  const label$ = page.getByTestId('month-label')
  for (let i = 0; i < 120; i++) {
    const cur = await label$.innerText()
    if (cur === label) return
    await page.getByRole('button', { name: Date.parse('1 ' + cur) > target ? 'Previous month' : 'Next month' }).click()
  }
  throw new Error('could not reach ' + label)
}

async function add(page: Page, o: { type?: 'income' | 'expense'; amount: string; cat?: string; date: string; note: string; repeat?: boolean }) {
  const form = page.getByRole('form', { name: 'Add transaction' })
  if (o.type) await form.getByText(o.type, { exact: true }).click()
  await form.getByLabel('Amount').fill(o.amount)
  if (o.cat) await form.getByLabel('Category').selectOption({ label: o.cat })
  await form.getByLabel('Date').fill(o.date)
  await form.getByLabel(/Note/).fill(o.note)
  if (o.repeat) await form.getByLabel('Repeat monthly').check()
  await form.getByRole('button', { name: 'Add transaction' }).click()
}

const row = (page: Page, text: string) => page.getByTestId('tx-row').filter({ hasText: text })

for (const s of sizes) {
  test.describe(s.name, () => {
    test.use({ viewport: { width: s.width, height: s.height } })

    test('recurring walkthrough', async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())
      await page.reload()

      // Not repeating by default; a plain transaction never appears later
      await expect(page.getByRole('form', { name: 'Add transaction' }).getByLabel('Repeat monthly')).not.toBeChecked()
      await add(page, { amount: '5', cat: 'Fun', date: '2026-01-02', note: 'One-off' })
      await add(page, { amount: '100', cat: 'Housing', date: '2026-01-31', note: 'Rent', repeat: true })
      await expect(page.getByTestId('month-label')).toHaveText('January 2026')
      await expect(row(page, 'Rent')).toContainText('2026-01-31')
      await expect(row(page, 'Rent').getByTestId('recurring-badge')).toBeVisible()
      await expect(row(page, 'One-off').getByTestId('recurring-badge')).toHaveCount(0)

      // Appears in later months on the same day, clamped to the last day
      await page.getByRole('button', { name: 'Next month' }).click()
      await expect(page.getByTestId('month-label')).toHaveText('February 2026')
      await expect(page.getByTestId('tx-row')).toHaveCount(1)
      await expect(row(page, 'Rent')).toContainText('2026-02-28')
      await expect(page.getByTestId('total-expenses')).toHaveText('$100.00')
      await page.getByRole('button', { name: 'Next month' }).click()
      await expect(row(page, 'Rent')).toContainText('2026-03-31')
      await page.getByRole('button', { name: 'Next month' }).click()
      await expect(row(page, 'Rent')).toContainText('2026-04-30')

      // No duplicates when reopening a month (switching back and forth, and after a reload)
      for (const m of ['February 2026', 'April 2026', 'February 2026']) {
        await goTo(page, m)
        await expect(page.getByTestId('tx-row')).toHaveCount(1)
      }
      await page.reload()
      await goTo(page, 'February 2026')
      await expect(page.getByTestId('tx-row')).toHaveCount(1)
      await goTo(page, 'January 2026')
      await expect(page.getByTestId('tx-row')).toHaveCount(2)
      await expect(page.getByTestId('total-expenses')).toHaveText('$105.00')

      // Leap year: 31st -> 29th (income repeats as income)
      await add(page, { type: 'income', amount: '50', cat: 'Other', date: '2028-01-31', note: 'Side gig', repeat: true })
      await goTo(page, 'February 2028')
      await expect(row(page, 'Side gig')).toContainText('2028-02-29')
      await expect(page.getByTestId('total-income')).toHaveText('$50.00')
      await goTo(page, 'February 2027')
      await expect(row(page, 'Rent')).toContainText('2027-02-28')

      // Edit a repeating transaction: checkbox is ticked; later months follow, earlier ones don't change
      await goTo(page, 'February 2026')
      await row(page, 'Rent').getByRole('button', { name: 'Edit transaction' }).click()
      const edit = page.getByRole('form', { name: 'Edit transaction' })
      await expect(edit.getByLabel('Repeat monthly')).toBeChecked()
      await edit.getByLabel('Amount').fill('120')
      await edit.getByRole('button', { name: 'Save changes' }).click()
      await expect(row(page, 'Rent')).toContainText('$120.00')
      await goTo(page, 'January 2026')
      await expect(row(page, 'Rent')).toContainText('$100.00')
      await goTo(page, 'March 2026')
      await expect(row(page, 'Rent')).toContainText('$120.00') // created before the edit, but it is a later month: follows
      await goTo(page, 'August 2026')
      await expect(row(page, 'Rent')).toContainText('$120.00')
      await expect(row(page, 'Rent')).toContainText('2026-08-31')

      // Recurring screen
      await page.getByRole('button', { name: 'Recurring', exact: false }).click()
      await expect(page.getByRole('heading', { name: 'Recurring transactions' })).toBeVisible()
      await expect(page.getByTestId('rule-row')).toHaveCount(2)
      const rent = page.getByTestId('rule-row').filter({ hasText: 'Rent' })
      await expect(rent).toContainText('Monthly on the 31st')
      await expect(rent).toContainText('since January 2026')
      await expect(rent).toContainText('$120.00')
      await expect(rent.getByTestId('rule-status')).toHaveText('Active')
      expect(await overflow()).toBe(false)

      // Stop from a chosen month; earlier months unchanged. Cancel first.
      await rent.getByRole('button', { name: 'Stop repeating…' }).click()
      await rent.getByRole('button', { name: 'Cancel' }).click()
      await expect(rent.getByTestId('rule-status')).toHaveText('Active')
      await rent.getByRole('button', { name: 'Stop repeating…' }).click()
      await rent.getByLabel('Stop from').selectOption({ label: 'May 2026' })
      await expect(rent).toContainText('Months before May 2026 stay as they are')
      if (s.name === 'mobile') {
        expect(await overflow()).toBe(false)
        await page.screenshot({ path: 'shots/recurring-mobile-stop.png', fullPage: true })
      } else {
        await page.screenshot({ path: 'shots/recurring-desktop-stop.png', fullPage: true })
      }
      await rent.getByRole('button', { name: 'Stop repeating' }).click()
      await expect(rent.getByTestId('rule-status')).toHaveText('Stopped from May 2026')
      await expect(rent.getByRole('button', { name: 'Stop repeating…' })).toHaveCount(0)
      await expect(page.getByTestId('rule-row').filter({ hasText: 'Side gig' }).getByTestId('rule-status')).toHaveText('Active')

      await page.getByRole('button', { name: 'Overview' }).click()
      for (const [m, expected] of [['January 2026', 1], ['February 2026', 1], ['March 2026', 1], ['April 2026', 1], ['May 2026', 0], ['August 2026', 0], ['February 2027', 0]] as const) {
        await goTo(page, m)
        await expect(page.getByTestId('tx-row').filter({ hasText: 'Rent' })).toHaveCount(expected)
      }
      await goTo(page, 'April 2026')
      await expect(row(page, 'Rent')).toContainText('$120.00') // last month before the stop: still there, unchanged
      await goTo(page, 'January 2026')
      await expect(row(page, 'Rent')).toContainText('$100.00')

      // Stop persists across a reload
      await page.reload()
      await page.getByRole('button', { name: 'Recurring' }).click()
      await expect(page.getByTestId('rule-row').filter({ hasText: 'Rent' }).getByTestId('rule-status')).toHaveText('Stopped from May 2026')
      await page.getByRole('button', { name: 'Overview' }).click()

      // Tick repeat while editing a plain transaction, then untick later
      await add(page, { amount: '50', cat: 'Health', date: '2026-06-10', note: 'Gym' })
      await expect(row(page, 'Gym').getByTestId('recurring-badge')).toHaveCount(0)
      await row(page, 'Gym').getByRole('button', { name: 'Edit transaction' }).click()
      await expect(page.getByRole('form', { name: 'Edit transaction' }).getByLabel('Repeat monthly')).not.toBeChecked()
      await page.getByRole('form', { name: 'Edit transaction' }).getByLabel('Repeat monthly').check()
      await page.getByRole('form', { name: 'Edit transaction' }).getByRole('button', { name: 'Save changes' }).click()
      await expect(row(page, 'Gym').getByTestId('recurring-badge')).toBeVisible()
      await goTo(page, 'July 2026')
      await expect(row(page, 'Gym')).toContainText('2026-07-10')
      await goTo(page, 'September 2026')
      await expect(row(page, 'Gym')).toHaveCount(1)
      await goTo(page, 'July 2026')
      await row(page, 'Gym').getByRole('button', { name: 'Edit transaction' }).click()
      await expect(page.getByRole('form', { name: 'Edit transaction' }).getByLabel('Repeat monthly')).toBeChecked()
      await page.getByRole('form', { name: 'Edit transaction' }).getByLabel('Repeat monthly').uncheck()
      await page.getByRole('form', { name: 'Edit transaction' }).getByRole('button', { name: 'Save changes' }).click()
      await expect(row(page, 'Gym')).toHaveCount(1)
      await goTo(page, 'August 2026')
      await expect(row(page, 'Gym')).toHaveCount(0)
      await goTo(page, 'June 2026')
      await expect(row(page, 'Gym')).toHaveCount(1)

      // Deleting one occurrence is not undone by reopening the month
      await goTo(page, 'February 2028')
      await row(page, 'Side gig').getByRole('button', { name: 'Delete transaction' }).click()
      await page.getByRole('button', { name: 'Confirm delete' }).click()
      await goTo(page, 'March 2028')
      await goTo(page, 'February 2028')
      await expect(row(page, 'Side gig')).toHaveCount(0)

      // CSV includes generated rows
      await goTo(page, 'March 2026')
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()])
      const fs = await import('node:fs')
      expect(fs.readFileSync((await dl.path())!, 'utf8')).toContain('2026-03-31,expense,Housing,120.00,Rent')

      expect(await overflow()).toBe(false)
      await page.getByRole('button', { name: 'Recurring' }).click()
      await page.screenshot({ path: `shots/recurring-${s.name}.png`, fullPage: true })
      expect(errors).toEqual([])
    })
  })
}
