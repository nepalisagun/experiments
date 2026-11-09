import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const sizes = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
]

async function add(page: Page, o: { type?: 'income' | 'expense'; amount: string; category?: string; date?: string; note?: string }) {
  const form = page.getByRole('form', { name: 'Transaction form' })
  await form.getByRole('radio', { name: o.type ?? 'expense' }).click()
  await form.getByLabel('Amount').fill(o.amount)
  if (o.category) await form.getByLabel('Category').selectOption({ label: o.category })
  if (o.date) await form.getByLabel('Date').fill(o.date)
  await form.getByLabel('Note (optional)').fill(o.note ?? '')
  await form.getByRole('button', { name: 'Add transaction' }).click()
}

for (const size of sizes) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } })

    test('every requirement end-to-end', async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-11-09T10:00:00'))
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())
      await page.reload()
      const shot = (n: string) => page.screenshot({ path: `shots/${size.name}-${n}.png`, fullPage: true })

      await expect(page.getByTestId('month-label')).toHaveText('November 2026')
      await expect(page.getByTestId('donut-empty')).toBeVisible()
      await shot('01-empty')

      // 10. Validation
      const form = page.getByRole('form', { name: 'Transaction form' })
      await form.getByRole('button', { name: 'Add transaction' }).click()
      await expect(form.getByText('Amount is required.')).toBeVisible()
      await form.getByLabel('Amount').fill('0')
      await form.getByLabel('Date').fill('')
      await form.getByRole('button', { name: 'Add transaction' }).click()
      await expect(form.getByText('Amount must be greater than zero.')).toBeVisible()
      await expect(form.getByText('Date is required.')).toBeVisible()
      await form.getByLabel('Amount').fill('-3')
      await form.getByRole('button', { name: 'Add transaction' }).click()
      await expect(form.getByText('Amount must be greater than zero.')).toBeVisible()
      await form.getByLabel('Amount').fill('abc')
      await form.getByRole('button', { name: 'Add transaction' }).click()
      await expect(form.getByText('Amount must be a number, e.g. 12.50.')).toBeVisible()
      await shot('02-validation')
      await expect(page.getByTestId('tx-row')).toHaveCount(0)

      // 1 + 2 + 9. Add transactions; 0.1 + 0.2 = 0.30
      await add(page, { type: 'income', amount: '2500', category: 'Other', date: '2026-11-01', note: 'Salary' })
      await add(page, { amount: '0.1', category: 'Food', date: '2026-11-02', note: 'Gum' })
      await add(page, { amount: '0.2', category: 'Food', date: '2026-11-03', note: 'Candy' })
      await expect(page.getByTestId('tx-row')).toHaveCount(3)
      // 4. Totals
      await expect(page.getByTestId('total-income')).toHaveText('2,500.00')
      await expect(page.getByTestId('total-expenses')).toHaveText('0.30')
      await expect(page.getByTestId('total-balance')).toHaveText('2,499.70')
      // 5. Donut
      await expect(page.getByTestId('donut')).toBeVisible()
      await expect(page.getByTestId('donut-legend')).toContainText('Food')
      await expect(page.getByTestId('donut-legend')).toContainText('0.30')

      // Edit
      await page.getByRole('button', { name: 'Edit Gum' }).click()
      await expect(form.getByRole('heading')).toHaveText('Edit transaction')
      await expect(form.getByLabel('Amount')).toHaveValue('0.10')
      await form.getByLabel('Amount').fill('49.90')
      await form.getByLabel('Category').selectOption({ label: 'Fun' })
      await form.getByLabel('Note (optional)').fill('Cinema')
      await form.getByRole('button', { name: 'Save changes' }).click()
      await expect(page.getByTestId('total-expenses')).toHaveText('50.10')
      await expect(page.getByText('Cinema')).toBeVisible()
      await expect(page.getByText('Gum')).toHaveCount(0)

      // Delete (with confirm)
      await page.getByRole('button', { name: 'Delete Candy' }).click()
      await page.getByTestId('tx-row').filter({ hasText: 'Candy' }).getByRole('button', { name: 'Keep' }).click()
      await expect(page.getByTestId('tx-row')).toHaveCount(3)
      await page.getByRole('button', { name: 'Delete Candy' }).click()
      await page.getByTestId('tx-row').filter({ hasText: 'Candy' }).getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(page.getByTestId('tx-row')).toHaveCount(2)
      await expect(page.getByText('Candy')).toHaveCount(0)
      await expect(page.getByTestId('total-expenses')).toHaveText('49.90')

      // More expenses for the chart
      await add(page, { amount: '1200', category: 'Housing', date: '2026-11-01', note: 'Rent' })
      await add(page, { amount: '35.5', category: 'Transport', date: '2026-11-04', note: 'Bus pass, "monthly"' })
      await add(page, { amount: '60', category: 'Health', date: '2026-11-05', note: 'Pharmacy' })

      // 2. Custom category
      const budgets = page.getByRole('region', { name: 'Categories and budgets' })
      await budgets.getByRole('button', { name: 'Add' }).click()
      await expect(budgets.getByText('Category name is required.')).toBeVisible()
      await budgets.getByLabel('New category').fill('food')
      await budgets.getByRole('button', { name: 'Add' }).click()
      await expect(budgets.getByText('already exists')).toBeVisible()
      await budgets.getByLabel('New category').fill('Pets')
      await budgets.getByLabel('Category colour').fill('#8b4513')
      await budgets.getByRole('button', { name: 'Add' }).click()
      await expect(page.getByTestId('budget-Pets')).toBeVisible()
      await add(page, { amount: '22.25', category: 'Pets', date: '2026-11-06', note: 'Dog food' })
      await expect(page.getByTestId('slice-Pets')).toHaveAttribute('stroke', '#8b4513')
      await expect(page.getByTestId('total-expenses')).toHaveText('1,367.65')

      // 6. Budgets: under, then over -> red
      await page.getByLabel('Fun monthly budget').fill('100')
      await page.getByLabel('Fun monthly budget').press('Enter')
      const funBar = page.getByRole('progressbar', { name: 'Fun budget used' })
      await expect(funBar).toHaveAttribute('data-over', 'false')
      await expect(page.getByTestId('budget-Fun')).toContainText('50.10 left (50%)')
      await page.getByLabel('Fun monthly budget').fill('40')
      await page.getByLabel('Fun monthly budget').press('Enter')
      await expect(funBar).toHaveAttribute('data-over', 'true')
      await expect(page.getByTestId('budget-Fun')).toContainText('Over budget by 9.90')
      const fill = await funBar.locator('div').evaluate((el) => getComputedStyle(el).backgroundColor)
      expect(fill).toBe('rgb(198, 47, 47)')
      await page.getByLabel('Food monthly budget').fill('0')
      await page.getByLabel('Food monthly budget').press('Enter')
      await expect(page.getByTestId('budget-Food')).toContainText('Budget must be greater than zero.')
      await page.getByLabel('Food monthly budget').fill('')
      await page.getByLabel('Food monthly budget').press('Enter')
      await shot('03-populated')

      // 7. Filters
      const txs = page.getByRole('region', { name: 'Transactions' })
      const clear = txs.getByRole('button', { name: 'Clear filters' })
      await expect(clear).toBeDisabled()
      // Clear button sits in the same row as the search box
      const sBox = (await txs.getByLabel('Search notes').boundingBox())!
      const cBox = (await clear.boundingBox())!
      expect(Math.abs(sBox.y + sBox.height / 2 - (cBox.y + cBox.height / 2))).toBeLessThan(2)
      expect(cBox.x).toBeGreaterThan(sBox.x + sBox.width - 1)
      expect(cBox.x + cBox.width).toBeLessThanOrEqual(size.width)
      // Income shows in teal
      const teal = 'rgb(13, 127, 128)'
      expect(await page.getByTestId('total-income').evaluate((el) => getComputedStyle(el).color)).toBe(teal)
      const salaryAmt = page.getByTestId('tx-row').filter({ hasText: 'Salary' }).getByText('+2,500.00')
      expect(await salaryAmt.evaluate((el) => getComputedStyle(el).color)).toBe(teal)
      // All three filters active, then cleared in one click
      await txs.getByLabel('Filter by type').selectOption('expense')
      await txs.getByLabel('Filter by category').selectOption({ label: 'Health' })
      await txs.getByLabel('Search notes').fill('pharm')
      await expect(page.getByTestId('tx-row')).toHaveCount(1)
      await expect(clear).toBeEnabled()
      await shot('04a-clear-enabled')
      await clear.click()
      await expect(page.getByTestId('tx-row')).toHaveCount(6)
      await expect(txs.getByLabel('Filter by type')).toHaveValue('')
      await expect(txs.getByLabel('Filter by category')).toHaveValue('')
      await expect(txs.getByLabel('Search notes')).toHaveValue('')
      await expect(clear).toBeDisabled()
      await txs.getByLabel('Filter by type').selectOption('income')
      await expect(page.getByTestId('tx-row')).toHaveCount(1)
      await expect(page.getByTestId('tx-row')).toContainText('Salary')
      await txs.getByLabel('Filter by type').selectOption('expense')
      await expect(page.getByTestId('tx-row')).toHaveCount(5)
      await txs.getByLabel('Filter by category').selectOption({ label: 'Housing' })
      await expect(page.getByTestId('tx-row')).toHaveCount(1)
      await txs.getByLabel('Filter by category').selectOption({ label: 'Food' })
      await expect(txs.getByText('No transactions match these filters.')).toBeVisible()
      await txs.getByRole('button', { name: 'Clear filters' }).click()
      await txs.getByLabel('Search notes').fill('PHARM')
      await expect(page.getByTestId('tx-row')).toHaveCount(1)
      await expect(page.getByTestId('tx-count')).toHaveText('1 of 6 shown')
      await shot('04-filtered')
      await txs.getByLabel('Search notes').fill('')

      // 8. CSV export
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()])
      expect(download.suggestedFilename()).toBe('budget-2026-11.csv')
      const csv = readFileSync((await download.path())!, 'utf8')
      const lines = csv.trimEnd().split('\r\n')
      expect(lines[0]).toBe('Date,Type,Category,Amount,Note')
      expect(lines).toHaveLength(7)
      expect(csv).toContain('2026-11-01,income,Other,2500.00,Salary')
      expect(csv).toContain('2026-11-04,expense,Transport,35.50,"Bus pass, ""monthly"""')

      // 3. Month switcher
      await page.getByRole('button', { name: 'Previous month' }).click()
      await expect(page.getByTestId('month-label')).toHaveText('October 2026')
      await expect(page.getByTestId('total-income')).toHaveText('0.00')
      await expect(page.getByTestId('total-expenses')).toHaveText('0.00')
      await expect(page.getByTestId('tx-row')).toHaveCount(0)
      await expect(page.getByTestId('donut-empty')).toBeVisible()
      await expect(page.getByTestId('budget-Fun')).not.toContainText('Over budget')
      await expect(page.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
      await add(page, { amount: '15', category: 'Food', note: 'October lunch' })
      await expect(page.getByTestId('tx-row')).toHaveCount(1)
      await expect(form.getByLabel('Date')).toHaveValue('2026-10-01')
      await expect(page.getByTestId('total-expenses')).toHaveText('15.00')
      // Adding into a different month jumps there
      await add(page, { amount: '5', category: 'Food', date: '2026-12-24', note: 'Xmas' })
      await expect(page.getByTestId('month-label')).toHaveText('December 2026')
      await expect(page.getByTestId('tx-row')).toHaveCount(1)
      await page.getByRole('button', { name: 'Today' }).click()
      await expect(page.getByTestId('month-label')).toHaveText('November 2026')
      await expect(page.getByTestId('tx-row')).toHaveCount(6)

      // No horizontal scroll
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow).toBeLessThanOrEqual(0)

      // 11. Persistence
      await page.reload()
      await expect(page.getByTestId('tx-row')).toHaveCount(6)
      await expect(page.getByTestId('total-expenses')).toHaveText('1,367.65')
      await expect(page.getByTestId('budget-Pets')).toBeVisible()
      await expect(page.getByLabel('Fun monthly budget')).toHaveValue('40.00')
      await expect(page.getByRole('progressbar', { name: 'Fun budget used' })).toHaveAttribute('data-over', 'true')
      // Hover the ring at 12 o'clock (Housing is the first, largest slice) -> centre label updates
      const box = (await page.getByTestId('donut').boundingBox())!
      await page.mouse.move(box.x + box.width / 2 + 4, box.y + box.height * 0.11)
      await expect(page.getByTestId('donut').locator('..')).toContainText('Housing')
      await expect(page.getByTestId('donut').locator('..')).toContainText('87.7%')
      await page.getByTestId('donut-legend').getByText('Health').hover()
      await expect(page.getByTestId('donut').locator('..')).toContainText('60.00')
      await shot('05-after-reload')
    })
  })
}
