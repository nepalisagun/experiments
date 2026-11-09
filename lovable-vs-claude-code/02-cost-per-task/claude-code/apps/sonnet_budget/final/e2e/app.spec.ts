import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'

const sizes = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 375, height: 700 },
]

async function add(page: Page, o: { type?: 'income' | 'expense'; amount: string; cat?: string; date?: string; note?: string }) {
  await page.getByRole('button', { name: '+ Add transaction' }).click()
  const d = page.getByRole('dialog')
  if (o.type) await d.getByRole('radio', { name: o.type }).click()
  await d.getByLabel('Amount').fill(o.amount)
  if (o.cat) await d.getByLabel('Category', { exact: true }).selectOption({ label: o.cat })
  if (o.date !== undefined) await d.getByLabel('Date').fill(o.date)
  if (o.note) await d.getByLabel(/Note/).fill(o.note)
  await d.getByRole('button', { name: 'Save' }).click()
}

for (const s of sizes) {
  test(`full walkthrough @ ${s.name}`, async ({ page }) => {
    await page.setViewportSize({ width: s.width, height: s.height })
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    fs.mkdirSync('shots', { recursive: true })

    // No horizontal overflow
    const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    expect(await noOverflow()).toBe(true)

    // Validation
    await page.getByRole('button', { name: '+ Add transaction' }).click()
    const dlg = page.getByRole('dialog')
    await dlg.getByLabel('Date').fill('')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByText('Amount is required.')).toBeVisible()
    await expect(dlg.getByText('Date is required.')).toBeVisible()
    await dlg.getByLabel('Amount').fill('0')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByText('Amount must be greater than zero.')).toBeVisible()
    await dlg.getByLabel('Amount').fill('-4')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(dlg.getByText('Amount must be greater than zero.')).toBeVisible()
    await page.screenshot({ path: `shots/${s.name}-validation.png` })
    await dlg.getByRole('button', { name: 'Cancel' }).click()

    // Add income 0.1 + 0.2 -> 0.30
    await add(page, { type: 'income', amount: '0.1', cat: 'Other', note: 'gift' })
    await add(page, { type: 'income', amount: '0.2', cat: 'Other', note: 'refund' })
    await expect(page.getByTestId('total-income')).toHaveText('0.30')

    // Expenses
    await add(page, { amount: '1000', cat: 'Housing', note: 'Rent' })
    await add(page, { amount: '45.50', cat: 'Food', note: 'Groceries' })
    await add(page, { amount: '12', cat: 'Fun', note: 'Cinema' })
    await expect(page.getByTestId('total-expenses')).toHaveText('1,057.50')
    await expect(page.getByTestId('total-balance')).toHaveText('-1,057.20')
    await expect(page.getByTestId('donut-slice')).toHaveCount(3)

    // Custom category
    await page.getByRole('button', { name: '+ Add transaction' }).click()
    await dlg.getByRole('button', { name: '+ New category' }).click()
    await dlg.getByLabel('New category name').fill('Pets')
    await dlg.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(dlg.getByLabel('Category', { exact: true })).toHaveValue(/^c_/)
    await dlg.getByLabel('Amount').fill('20')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('donut-slice')).toHaveCount(4)

    // Edit
    await page.getByRole('button', { name: /^Edit Fun/ }).click()
    await dlg.getByLabel('Amount').fill('15.25')
    await dlg.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('total-expenses')).toHaveText('1,080.75')

    // Budgets
    const foodBudget = page.getByLabel('Budget for Food')
    await foodBudget.fill('40')
    await foodBudget.blur()
    const bar = page.getByTestId('budget-bar').first()
    await expect(bar).toHaveAttribute('data-over', 'true')
    await expect(page.getByText('Over budget by 5.50')).toBeVisible()
    await foodBudget.fill('100')
    await foodBudget.blur()
    await expect(bar).toHaveAttribute('data-over', 'false')
    await page.getByLabel('Budget for Food').fill('40')
    await page.getByLabel('Budget for Food').blur()
    await page.screenshot({ path: `shots/${s.name}-main.png`, fullPage: true })

    // Filters
    await page.getByLabel('Filter by type').selectOption('income')
    await expect(page.getByTestId('tx-row')).toHaveCount(2)
    await page.getByLabel('Filter by type').selectOption('')
    await page.getByLabel('Filter by category').selectOption({ label: 'Food' })
    await expect(page.getByTestId('tx-row')).toHaveCount(1)
    await page.getByLabel('Filter by category').selectOption('')
    await page.getByLabel('Search notes').fill('cine')
    await expect(page.getByTestId('tx-row')).toHaveCount(1)
    await page.getByLabel('Search notes').fill('zzz')
    await expect(page.getByText('No transactions match your filters.')).toBeVisible()
    // Clear filters button
    const clear = page.getByRole('button', { name: 'Clear filters' })
    await page.getByLabel('Filter by type').selectOption('income')
    await page.getByLabel('Filter by category').selectOption({ label: 'Other' })
    await expect(clear).toBeEnabled()
    await page.screenshot({ path: `shots/${s.name}-filters.png` })
    await clear.click()
    await expect(page.getByTestId('tx-row')).toHaveCount(6)
    await expect(page.getByLabel('Search notes')).toHaveValue('')
    await expect(page.getByLabel('Filter by type')).toHaveValue('')
    await expect(page.getByLabel('Filter by category')).toHaveValue('')
    await expect(clear).toBeDisabled()
    // Income colour is teal
    await expect(page.getByTestId('total-income')).toHaveCSS('color', 'oklch(0.6 0.118 184.704)')
    expect(await noOverflow()).toBe(true)

    // Reload persistence
    await page.reload()
    await expect(page.getByTestId('total-expenses')).toHaveText('1,080.75')
    await expect(page.getByLabel('Budget for Food')).toHaveValue('40.00')
    await expect(page.getByTestId('tx-row')).toHaveCount(6)

    // CSV
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()])
    const csv = fs.readFileSync((await dl.path())!, 'utf8')
    expect(dl.suggestedFilename()).toMatch(/^transactions-\d{4}-\d{2}\.csv$/)
    expect(csv).toContain('Date,Type,Category,Amount,Note')
    expect(csv).toContain('expense,Food,45.50,Groceries')
    expect(csv.split('\r\n')).toHaveLength(7)

    // Month switcher scopes everything
    const label = await page.getByTestId('month-label').innerText()
    await page.getByRole('button', { name: 'Previous month' }).click()
    await expect(page.getByTestId('month-label')).not.toHaveText(label)
    await expect(page.getByTestId('total-income')).toHaveText('0.00')
    await expect(page.getByTestId('tx-row')).toHaveCount(0)
    await expect(page.getByText('No expenses this month.')).toBeVisible()
    await page.screenshot({ path: `shots/${s.name}-empty-month.png` })
    await page.getByRole('button', { name: 'Next month' }).click()
    await expect(page.getByTestId('tx-row')).toHaveCount(6)

    // Delete
    page.once('dialog', (d) => d.accept())
    await page.getByRole('button', { name: /^Delete Pets/ }).click()
    await expect(page.getByTestId('tx-row')).toHaveCount(5)
    await expect(page.getByTestId('total-expenses')).toHaveText('1,060.75')
    expect(await noOverflow()).toBe(true)
  })
}
