import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const sizes = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 375, height: 800 },
]

async function add(page: Page, o: { type?: 'income' | 'expense'; amount: string; cat?: string; date?: string; note?: string }) {
  const form = page.getByRole('form', { name: 'Add transaction' })
  if (o.type) await form.getByText(o.type, { exact: true }).click()
  await form.getByLabel('Amount').fill(o.amount)
  if (o.cat) await form.getByLabel('Category').selectOption({ label: o.cat })
  if (o.date) await form.getByLabel('Date').fill(o.date)
  if (o.note !== undefined) await form.getByLabel(/Note/).fill(o.note)
  await form.getByRole('button', { name: 'Add transaction' }).click()
}

for (const s of sizes) {
  test.describe(s.name, () => {
    test.use({ viewport: { width: s.width, height: s.height } })

    test('full walkthrough', async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())
      await page.reload()

      // No horizontal overflow
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
      expect(await overflow()).toBe(false)

      // Use a fixed month so assertions are stable: navigate to a known one via adding with dates.
      await add(page, { type: 'income', amount: '1000', cat: 'Other', date: '2026-03-01', note: 'Salary' })
      await expect(page.getByTestId('month-label')).toHaveText('March 2026')

      // 10. validation
      const form = page.getByRole('form', { name: 'Add transaction' })
      await form.getByRole('button', { name: 'Add transaction' }).click()
      await expect(form.getByText('Enter an amount.')).toBeVisible()
      await form.getByLabel('Amount').fill('0')
      await form.getByLabel('Date').fill('')
      await form.getByRole('button', { name: 'Add transaction' }).click()
      await expect(form.getByText('Amount must be greater than zero.')).toBeVisible()
      await expect(form.getByText('Pick a date.')).toBeVisible()
      await form.getByLabel('Amount').fill('-4')
      await form.getByRole('button', { name: 'Add transaction' }).click()
      await expect(form.getByText('Amount must be greater than zero.')).toBeVisible()
      await form.getByLabel('Amount').fill('abc')
      await form.getByRole('button', { name: 'Add transaction' }).click()
      await expect(form.getByText(/at most 2 decimals/)).toBeVisible()
      await expect(page.getByTestId('tx-row')).toHaveCount(1)

      // 9. float-free: 0.1 + 0.2
      await add(page, { amount: '0.1', cat: 'Food', date: '2026-03-02', note: 'Coffee beans' })
      await add(page, { amount: '0.2', cat: 'Food', date: '2026-03-03', note: 'Tea' })
      await expect(page.getByTestId('total-expenses')).toHaveText('$0.30')
      await expect(page.getByTestId('total-balance')).toHaveText('$999.70')

      // more data
      await add(page, { amount: '200.50', cat: 'Housing', date: '2026-03-05', note: 'Rent share' })
      await add(page, { amount: '49.99', cat: 'Fun', date: '2026-03-09', note: 'Cinema, "IMAX"' })
      await add(page, { amount: '77', cat: 'Food', date: '2026-04-02', note: 'April only' })
      await expect(page.getByTestId('month-label')).toHaveText('April 2026')

      // 3. month switcher isolates
      await page.getByRole('button', { name: 'Previous month' }).click()
      await expect(page.getByTestId('month-label')).toHaveText('March 2026')
      await expect(page.getByTestId('tx-row')).toHaveCount(5)
      await expect(page.getByTestId('total-expenses')).toHaveText('$250.79')
      await page.getByRole('button', { name: 'Next month' }).click()
      await expect(page.getByTestId('total-expenses')).toHaveText('$77.00')
      await expect(page.getByTestId('total-income')).toHaveText('$0.00')
      await page.getByRole('button', { name: 'Previous month' }).click()

      // 5. donut: slices for Food, Housing, Fun only
      await expect(page.getByTestId('slice-food')).toBeAttached()
      await expect(page.getByTestId('slice-housing')).toBeAttached()
      await expect(page.getByTestId('slice-fun')).toBeAttached()
      await expect(page.getByTestId('slice-health')).toHaveCount(0)

      // 6. budgets
      const food = page.getByTestId('budget-food')
      await food.getByLabel('Food budget').fill('0.25')
      await food.getByLabel('Food budget').press('Enter')
      await expect(food.getByRole('progressbar')).toHaveAttribute('data-over', 'true')
      await expect(food).toContainText('over by $0.05')
      await expect(food.locator('[role=progressbar] > div')).toHaveClass(/bg-red-600/)
      await food.getByLabel('Food budget').fill('100')
      await food.getByLabel('Food budget').press('Enter')
      await expect(food.getByRole('progressbar')).toHaveAttribute('data-over', 'false')
      await expect(food.locator('[role=progressbar] > div')).toHaveClass(/bg-emerald-500/)
      await food.getByLabel('Food budget').fill('-1')
      await food.getByLabel('Food budget').press('Enter')
      await expect(food.getByText('Enter an amount above zero.')).toBeVisible()
      await food.getByLabel('Food budget').fill('0.25')
      await food.getByLabel('Food budget').press('Enter')

      // 2. custom category
      const addCat = page.getByRole('form', { name: 'Add category' })
      await addCat.getByRole('button', { name: 'Add' }).click()
      await expect(addCat.getByText('Give the category a name.')).toBeVisible()
      await addCat.getByLabel('New category').fill('food')
      await addCat.getByRole('button', { name: 'Add' }).click()
      await expect(addCat.getByText('That category already exists.')).toBeVisible()
      await addCat.getByLabel('New category').fill('Pets')
      await addCat.getByRole('button', { name: 'Add' }).click()
      await expect(page.getByLabel('Pets budget')).toBeVisible()
      await add(page, { amount: '12', cat: 'Pets', date: '2026-03-10', note: 'Dog food' })
      await expect(page.getByTestId('slice-food')).toBeAttached()
      await expect(page.locator('[data-testid^=slice-c]')).toHaveCount(1)

      // 7. filters + search
      await page.getByLabel('Filter by category').selectOption({ label: 'Food' })
      await expect(page.getByTestId('tx-row')).toHaveCount(2)
      await page.getByLabel('Filter by category').selectOption('all')
      await page.getByLabel('Filter by type').selectOption('income')
      await expect(page.getByTestId('tx-row')).toHaveCount(1)
      await page.getByLabel('Filter by type').selectOption('all')
      await page.getByLabel('Search notes').fill('DOG')
      await expect(page.getByTestId('tx-row')).toHaveCount(1)
      await page.getByLabel('Search notes').fill('zzz')
      await expect(page.getByText('No transactions match your filters.')).toBeVisible()
      await page.getByRole('button', { name: 'Clear filters' }).click()
      await expect(page.getByTestId('tx-row')).toHaveCount(6)

      // Clear filters button: disabled when idle, resets category + type + search together
      const clear = page.getByRole('button', { name: 'Clear filters' })
      await expect(clear).toBeDisabled()
      await page.getByLabel('Filter by category').selectOption({ label: 'Food' })
      await expect(clear).toBeEnabled()
      await page.getByLabel('Filter by type').selectOption('expense')
      await page.getByLabel('Search notes').fill('Tea')
      await expect(page.getByTestId('tx-row')).toHaveCount(1)
      await clear.click()
      await expect(page.getByLabel('Filter by category')).toHaveValue('all')
      await expect(page.getByLabel('Filter by type')).toHaveValue('all')
      await expect(page.getByLabel('Search notes')).toHaveValue('')
      await expect(page.getByTestId('tx-row')).toHaveCount(6)
      await expect(clear).toBeDisabled()
      // button sits next to the filters and inside the viewport
      const box = await clear.boundingBox()
      expect(box!.x + box!.width).toBeLessThanOrEqual(s.width)

      // income is teal (total, row amount, type toggle)
      await expect(page.getByTestId('total-income')).toHaveClass(/text-teal-600/)
      await expect(page.getByTestId('tx-row').filter({ hasText: 'Salary' }).locator('p.font-semibold')).toHaveClass(/text-teal-600/)
      await page.getByRole('form', { name: 'Add transaction' }).getByText('income', { exact: true }).click()
      await expect(page.getByRole('form', { name: 'Add transaction' }).locator('label', { hasText: 'income' })).toHaveClass(/bg-teal-600/)
      await page.getByRole('form', { name: 'Add transaction' }).getByText('expense', { exact: true }).click()

      // 8. CSV export (whole month, even when filtered)
      await page.getByLabel('Search notes').fill('Tea')
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()])
      expect(dl.suggestedFilename()).toBe('transactions-2026-03.csv')
      const csv = readFileSync((await dl.path())!, 'utf8')
      expect(csv.split('\r\n')[0]).toBe('Date,Type,Category,Amount,Note')
      expect(csv).toContain('2026-03-03,expense,Food,0.20,Tea')
      expect(csv).toContain('2026-03-09,expense,Fun,49.99,"Cinema, ""IMAX"""')
      expect(csv).not.toContain('April only')
      expect(csv.trim().split('\r\n')).toHaveLength(7)
      await page.getByLabel('Search notes').fill('')

      // 1. edit
      const row = page.getByTestId('tx-row').filter({ hasText: 'Rent share' })
      await row.getByRole('button', { name: 'Edit transaction' }).click()
      const edit = page.getByRole('form', { name: 'Edit transaction' })
      await expect(edit.getByLabel('Amount')).toHaveValue('200.50')
      await edit.getByLabel('Amount').fill('300.10')
      await edit.getByLabel(/Note/).fill('Rent full')
      await edit.getByRole('button', { name: 'Save changes' }).click()
      await expect(page.getByTestId('tx-row').filter({ hasText: 'Rent full' })).toContainText('$300.10')
      await expect(page.getByRole('form', { name: 'Add transaction' })).toBeVisible()
      // edit validation
      await page.getByTestId('tx-row').filter({ hasText: 'Rent full' }).getByRole('button', { name: 'Edit transaction' }).click()
      await page.getByRole('form', { name: 'Edit transaction' }).getByLabel('Amount').fill('0')
      await page.getByRole('form', { name: 'Edit transaction' }).getByRole('button', { name: 'Save changes' }).click()
      await expect(page.getByText('Amount must be greater than zero.')).toBeVisible()
      await page.getByRole('button', { name: 'Cancel' }).click()

      // 11. persistence
      await page.reload()
      await expect(page.getByTestId('month-label')).toHaveText(/20\d\d/)
      // reload resets to the current month; go back to March 2026
      for (let i = 0; i < 400 && (await page.getByTestId('month-label').innerText()) !== 'March 2026'; i++)
        await page.getByRole('button', { name: 'Previous month' }).click()
      await expect(page.getByTestId('tx-row')).toHaveCount(6)
      await expect(page.getByTestId('tx-row').filter({ hasText: 'Rent full' })).toBeVisible()
      await expect(page.getByLabel('Food budget')).toHaveValue('0.25')
      await expect(page.getByLabel('Pets budget')).toBeVisible()

      // 1. delete
      const dog = page.getByTestId('tx-row').filter({ hasText: 'Dog food' })
      await dog.getByRole('button', { name: 'Delete transaction' }).click()
      await dog.getByRole('button', { name: 'No' }).click()
      await expect(page.getByTestId('tx-row')).toHaveCount(6)
      await dog.getByRole('button', { name: 'Delete transaction' }).click()
      await page.getByRole('button', { name: 'Confirm delete' }).click()
      await expect(page.getByTestId('tx-row')).toHaveCount(5)

      expect(await overflow()).toBe(false)
      await page.screenshot({ path: `shots/${s.name}.png`, fullPage: true })
      expect(errors).toEqual([])
    })
  })
}
