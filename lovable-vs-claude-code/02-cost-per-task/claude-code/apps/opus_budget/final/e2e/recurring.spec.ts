import { expect, test, type Page } from '@playwright/test'

const sizes = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
]

async function add(page: Page, o: { type?: 'income' | 'expense'; amount: string; category: string; date: string; note: string; repeat?: boolean }) {
  const form = page.getByRole('form', { name: 'Transaction form' })
  await form.getByRole('radio', { name: o.type ?? 'expense' }).click()
  await form.getByLabel('Amount').fill(o.amount)
  await form.getByLabel('Category').selectOption({ label: o.category })
  await form.getByLabel('Date').fill(o.date)
  await form.getByLabel('Note (optional)').fill(o.note)
  await form.getByLabel('Repeat monthly').setChecked(!!o.repeat)
  await form.getByRole('button', { name: 'Add transaction' }).click()
}

const stored = (page: Page, note: string) =>
  page.evaluate((n) => JSON.parse(localStorage.getItem('budget-tracker:v1')!).transactions.filter((t: { note: string }) => t.note === n).length, note)

for (const size of sizes) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } })

    test('recurring transactions end-to-end', async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-01-15T10:00:00'))
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())
      await page.reload()
      const shot = (n: string) => page.screenshot({ path: `shots/rec-${size.name}-${n}.png`, fullPage: true })
      const form = page.getByRole('form', { name: 'Transaction form' })
      const rows = page.getByTestId('tx-row')
      const row = (text: string) => rows.filter({ hasText: text })
      const goMonth = (m: string) => page.getByTestId('month-input').fill(m)
      const label = page.getByTestId('month-label')
      const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)

      await expect(label).toHaveText('January 2026')

      // Mark as repeating while adding (hint explains short months)
      await form.getByLabel('Date').fill('2026-01-31')
      await form.getByLabel('Repeat monthly').check()
      await expect(page.getByTestId('repeat-hint')).toHaveText('Adds it to every later month on the 31st (or the last day in shorter months).')
      await add(page, { amount: '1200', category: 'Housing', date: '2026-01-31', note: 'Rent', repeat: true })
      await expect(form.getByLabel('Repeat monthly')).not.toBeChecked() // resets after save
      await add(page, { type: 'income', amount: '3000', category: 'Other', date: '2026-01-01', note: 'Salary', repeat: true })
      await add(page, { amount: '10', category: 'Food', date: '2026-01-20', note: 'Lunch' })
      await expect(rows).toHaveCount(3)
      await expect(row('Rent').getByTestId('monthly-badge')).toBeVisible()
      await expect(row('Salary').getByTestId('monthly-badge')).toBeVisible()
      await expect(row('Lunch').getByTestId('monthly-badge')).toHaveCount(0)
      await shot('01-jan')

      // Later months: same day, clamped to the last day in short months
      await page.getByRole('button', { name: 'Next month' }).click()
      await expect(label).toHaveText('February 2026')
      await expect(rows).toHaveCount(2)
      await expect(row('Rent')).toContainText('2026-02-28')
      await expect(row('Salary')).toContainText('2026-02-01')
      await expect(row('Lunch')).toHaveCount(0)
      await expect(page.getByTestId('total-expenses')).toHaveText('1,200.00')
      await expect(page.getByTestId('total-income')).toHaveText('3,000.00')
      await shot('02-feb')
      await page.getByRole('button', { name: 'Next month' }).click()
      await expect(row('Rent')).toContainText('2026-03-31')
      await page.getByRole('button', { name: 'Next month' }).click()
      await expect(label).toHaveText('April 2026')
      await expect(row('Rent')).toContainText('2026-04-30')

      // No duplicates when months are opened again, also after a reload
      await page.getByRole('button', { name: 'Previous month' }).click()
      await page.getByRole('button', { name: 'Previous month' }).click()
      await expect(label).toHaveText('February 2026')
      await expect(rows).toHaveCount(2)
      await page.getByRole('button', { name: 'Next month' }).click()
      await expect(rows).toHaveCount(2)
      expect(await stored(page, 'Rent')).toBe(4)
      await page.reload()
      await goMonth('2026-04')
      await expect(label).toHaveText('April 2026')
      await expect(rows).toHaveCount(2)
      expect(await stored(page, 'Rent')).toBe(4)

      // Jumping ahead fills the months in between; leap-year February gets the 29th
      await goMonth('2028-02')
      await expect(label).toHaveText('February 2028')
      await expect(row('Rent')).toContainText('2028-02-29')
      expect(await stored(page, 'Rent')).toBe(26) // Jan 2026 .. Feb 2028
      await goMonth('2026-11')
      await expect(row('Rent')).toContainText('2026-11-30')
      await expect(rows).toHaveCount(2)

      // Edit an occurrence: this and later months change, earlier stay
      await goMonth('2026-03')
      await row('Rent').getByRole('button', { name: 'Edit Rent' }).click()
      await expect(form.getByLabel('Repeat monthly')).toBeChecked()
      await expect(page.getByTestId('repeat-hint')).toHaveText('Changes apply to this month and all later months. Earlier months stay as they are.')
      await form.getByLabel('Date').fill('2026-04-10')
      await form.getByRole('button', { name: 'Save changes' }).click()
      await expect(form.getByText('A repeating transaction must stay in its month.', { exact: false })).toBeVisible()
      await form.getByLabel('Date').fill('2026-03-31')
      await form.getByLabel('Amount').fill('1300')
      await form.getByRole('button', { name: 'Save changes' }).click()
      await expect(row('Rent')).toContainText('1,300.00')
      await page.getByRole('button', { name: 'Previous month' }).click()
      await expect(row('Rent')).toContainText('1,200.00')
      await goMonth('2026-08')
      await expect(row('Rent')).toContainText('1,300.00')
      await expect(row('Rent')).toContainText('2026-08-31')

      // Deleting one occurrence doesn't bring it back
      await goMonth('2026-04')
      await page.getByRole('button', { name: 'Delete Salary' }).click()
      await row('Salary').getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(row('Salary')).toHaveCount(0)
      await page.getByRole('button', { name: 'Next month' }).click()
      await expect(row('Salary')).toHaveCount(1)
      await page.getByRole('button', { name: 'Previous month' }).click()
      await expect(row('Salary')).toHaveCount(0)
      await noOverflow()

      // Recurring screen lists all repeating transactions
      await page.getByRole('button', { name: /^Recurring/ }).click()
      await expect(page).toHaveURL(/#recurring$/)
      const rules = page.getByTestId('rule')
      await expect(rules).toHaveCount(2)
      const rent = rules.filter({ hasText: 'Rent' })
      const salary = rules.filter({ hasText: 'Salary' })
      await expect(rent).toContainText('every month on the 31st (last day in shorter months)')
      await expect(rent).toContainText('1,300.00')
      await expect(rent.getByTestId('rule-range')).toHaveText('January 2026 → no end date · 26 so far')
      await expect(salary).toContainText('every month on the 1st')
      await expect(salary).toContainText('+3,000.00')
      await expect(rent.getByTestId('rule-status')).toHaveText('Active')
      await noOverflow()
      await shot('03-recurring')

      // Stop Rent from June 2026 on
      await rent.getByRole('button', { name: 'Stop…' }).click()
      await rent.getByLabel('Stop from (first month without it)').fill('2026-06')
      await expect(rent.getByTestId('stop-summary')).toHaveText(
        'May 2026 and earlier stay as they are. 21 transactions from June 2026 on will be removed.',
      )
      await noOverflow()
      await shot('04-stop-panel')
      await rent.getByRole('button', { name: 'Stop from June 2026' }).click()
      await expect(rent.getByTestId('rule-status')).toHaveText('Stopped')
      await expect(rent.getByTestId('rule-range')).toHaveText('January 2026 → May 2026 · 5 so far')
      // Can't "stop" from a later month than it already stops
      await rent.getByRole('button', { name: 'Stop earlier…' }).click()
      await rent.getByLabel('Stop from (first month without it)').fill('2026-09')
      await rent.getByRole('button', { name: 'Stop from September 2026' }).click()
      await expect(rent.getByText('It already stops from June 2026. Choose an earlier month.')).toBeVisible()
      await rent.getByRole('button', { name: 'Cancel' }).click()

      // Months before are unchanged, months from June on have no Rent, and it never comes back
      await page.getByRole('button', { name: 'Overview' }).click()
      await goMonth('2026-05')
      await expect(row('Rent')).toContainText('1,300.00')
      await expect(row('Rent')).toContainText('2026-05-31')
      await goMonth('2026-03')
      await expect(row('Rent')).toContainText('1,300.00')
      await goMonth('2026-02')
      await expect(row('Rent')).toContainText('1,200.00')
      await goMonth('2026-06')
      await expect(row('Rent')).toHaveCount(0)
      await expect(row('Salary')).toHaveCount(1)
      await goMonth('2029-01')
      await expect(row('Rent')).toHaveCount(0)
      expect(await stored(page, 'Rent')).toBe(5)

      // Stopping survives reload
      await page.goto('/#recurring')
      await page.reload()
      await expect(page.getByTestId('rule').filter({ hasText: 'Rent' }).getByTestId('rule-status')).toHaveText('Stopped')
      await page.getByRole('button', { name: 'Overview' }).click()

      // Untick repeat when editing: keeps this one, stops from this month
      await goMonth('2026-02')
      await row('Salary').getByRole('button', { name: 'Edit Salary' }).click()
      await form.getByLabel('Repeat monthly').uncheck()
      await expect(page.getByTestId('repeat-hint')).toHaveText('Keeps this one and stops repeating from February 2026 on.')
      await form.getByRole('button', { name: 'Save changes' }).click()
      await expect(row('Salary')).toHaveCount(1)
      await expect(row('Salary').getByTestId('monthly-badge')).toHaveCount(0)
      await page.getByRole('button', { name: 'Next month' }).click()
      await expect(row('Salary')).toHaveCount(0)
      await page.getByRole('button', { name: /^Recurring/ }).click()
      await expect(salary.getByTestId('rule-range')).toHaveText('January 2026 → January 2026 · 1 so far')

      // Stopping from the first month removes it entirely
      await salary.getByRole('button', { name: 'Stop earlier…' }).click()
      await salary.getByLabel('Stop from (first month without it)').fill('2026-01')
      await expect(salary.getByTestId('stop-summary')).toHaveText('This removes the repeating transaction and all 1 of its transactions.')
      await salary.getByRole('button', { name: 'Stop from January 2026' }).click()
      await expect(page.getByTestId('rule')).toHaveCount(1)
      await page.getByRole('button', { name: 'Overview' }).click()
      await goMonth('2026-01')
      await expect(row('Salary')).toHaveCount(0)
      await expect(row('Rent')).toHaveCount(1)

      // Turn an existing one-off into a repeating transaction
      await row('Lunch').getByRole('button', { name: 'Edit Lunch' }).click()
      await expect(form.getByLabel('Repeat monthly')).not.toBeChecked()
      await form.getByLabel('Repeat monthly').check()
      await form.getByRole('button', { name: 'Save changes' }).click()
      await expect(row('Lunch').getByTestId('monthly-badge')).toBeVisible()
      await page.getByRole('button', { name: 'Next month' }).click()
      await expect(row('Lunch')).toContainText('2026-02-20')
      await page.getByRole('button', { name: /^Recurring/ }).click()
      await expect(page.getByTestId('rule')).toHaveCount(2)
      await expect(page.getByRole('button', { name: /^Recurring/ })).toContainText('1') // one active rule
      await shot('05-final')
    })
  })
}
