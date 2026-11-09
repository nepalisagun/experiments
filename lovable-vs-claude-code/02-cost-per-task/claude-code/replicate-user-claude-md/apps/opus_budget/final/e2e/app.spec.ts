import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const sizes = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
]

const pad = (n: number) => String(n).padStart(2, '0')
const now = new Date()
const thisMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
const day = (d: number) => `${thisMonth}-${pad(d)}`

async function addTx(page: Page, o: { type?: 'Income' | 'Expense'; amount: string; category: string; date: string; note?: string }) {
  const form = page.getByRole('form', { name: 'Add transaction' })
  await form.getByText(o.type ?? 'Expense', { exact: true }).click()
  await form.getByLabel('Amount').fill(o.amount)
  await form.getByLabel('Date').fill(o.date)
  await form.getByLabel('Category').selectOption({ label: o.category })
  await form.getByLabel(/Note/).fill(o.note ?? '')
  await form.getByRole('button', { name: 'Add transaction' }).click()
}

for (const size of sizes) {
  test(`every requirement works at ${size.name} (${size.width}px)`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height })
    page.on('dialog', (d) => d.accept())
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await page.screenshot({ path: `shots/${size.name}-empty.png`, fullPage: true })

    // 2. default categories
    for (const c of ['Food', 'Housing', 'Transport', 'Fun', 'Health', 'Other']) await expect(page.getByTestId(`cat-row-${c}`)).toBeVisible()

    // 10. validation
    const form = page.getByRole('form', { name: 'Add transaction' })
    await form.getByRole('button', { name: 'Add transaction' }).click()
    await expect(form.getByText('Enter an amount.')).toBeVisible()
    await form.getByLabel('Amount').fill('0')
    await form.getByLabel('Date').fill('')
    await form.getByRole('button', { name: 'Add transaction' }).click()
    await expect(form.getByText('Amount must be above zero.')).toBeVisible()
    await expect(form.getByText('A date is required.')).toBeVisible()
    await form.getByLabel('Amount').fill('-4')
    await form.getByRole('button', { name: 'Add transaction' }).click()
    await expect(form.getByText('Amount must be above zero.')).toBeVisible()
    await form.getByLabel('Amount').fill('abc')
    await form.getByRole('button', { name: 'Add transaction' }).click()
    await expect(form.getByText('Amount must be a number, e.g. 12.50.')).toBeVisible()
    await page.screenshot({ path: `shots/${size.name}-validation.png`, fullPage: true })
    await expect(page.getByTestId('tx-row')).toHaveCount(0)

    // 1. add
    await addTx(page, { type: 'Income', amount: '3000', category: 'Other', date: day(1), note: 'Salary' })
    await addTx(page, { amount: '0.1', category: 'Food', date: day(2), note: 'Coffee' })
    await addTx(page, { amount: '0.2', category: 'Food', date: day(3), note: 'Snack' })
    await expect(page.getByTestId('tx-row')).toHaveCount(3)

    // 9. 0.1 + 0.2
    await expect(page.getByTestId('total-expenses')).toHaveText('0.30')
    await addTx(page, { amount: '800', category: 'Housing', date: day(4), note: 'Rent' })

    // 4. totals
    await expect(page.getByTestId('total-income')).toHaveText('3,000.00')
    await expect(page.getByTestId('total-expenses')).toHaveText('800.30')
    await expect(page.getByTestId('total-balance')).toHaveText('2,199.70')

    // 5. donut: expenses only, by category
    await expect(page.getByTestId('donut-seg-Housing')).toHaveCount(1)
    await expect(page.getByTestId('donut-seg-Food')).toHaveCount(1)
    await expect(page.getByTestId('donut-seg-Other')).toHaveCount(0)
    await page.getByRole('list', { name: 'Expenses by category' }).getByText('Food').hover()
    await expect(page.locator('[aria-live=polite]')).toContainText('0.30')

    // 6. budgets
    await page.getByLabel('Monthly budget for Food').fill('0.25')
    await page.getByLabel('Monthly budget for Food').press('Enter')
    await page.getByLabel('Monthly budget for Housing').fill('1000')
    await page.getByLabel('Monthly budget for Housing').press('Enter')
    await expect(page.getByTestId('budget-Food')).toHaveAttribute('data-over', 'true')
    await expect(page.getByTestId('budget-Food').getByTestId('bar-fill')).toHaveClass(/bg-red-600/)
    await expect(page.getByTestId('budget-Food')).toContainText('over by 0.05')
    await expect(page.getByTestId('budget-Housing')).toHaveAttribute('data-over', 'false')
    await expect(page.getByTestId('budget-Housing').getByRole('progressbar')).toHaveAttribute('aria-valuenow', '80')
    await page.screenshot({ path: `shots/${size.name}-over-budget.png`, fullPage: true })
    await page.getByLabel('Monthly budget for Fun').fill('0')
    await page.getByLabel('Monthly budget for Fun').press('Enter')
    await expect(page.getByText('Amount must be above zero.')).toBeVisible()
    await page.getByLabel('Monthly budget for Fun').fill('')
    await page.getByLabel('Monthly budget for Fun').press('Enter')

    // 1. edit
    await page.getByRole('button', { name: 'Edit Coffee' }).click()
    const edit = page.getByRole('form', { name: 'Edit transaction' })
    await expect(edit.getByLabel('Amount')).toHaveValue('0.10')
    await edit.getByLabel('Amount').fill('0.15')
    await edit.getByLabel(/Note/).fill('Flat white')
    await edit.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Flat white')).toBeVisible()
    await expect(page.getByTestId('total-expenses')).toHaveText('800.35')
    // cancel edit leaves things unchanged
    await page.getByRole('button', { name: 'Edit Rent' }).click()
    await page.getByRole('form', { name: 'Edit transaction' }).getByLabel('Amount').fill('1')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByTestId('total-expenses')).toHaveText('800.35')

    // 1. delete
    await page.getByRole('button', { name: 'Delete Snack' }).click()
    await expect(page.getByText('Snack')).toHaveCount(0)
    await expect(page.getByTestId('total-expenses')).toHaveText('800.15')
    await expect(page.getByTestId('budget-Food')).toHaveAttribute('data-over', 'false')

    // 2. custom category
    await page.getByLabel('New category name').fill('food')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByText('That category already exists.')).toBeVisible()
    await page.getByLabel('New category name').fill('Pets')
    await page.locator('#new-cat-color').fill('#6250d6')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByTestId('cat-row-Pets')).toBeVisible()
    await addTx(page, { amount: '42.50', category: 'Pets', date: day(5), note: 'Vet visit' })
    await expect(page.getByTestId('donut-seg-Pets')).toHaveAttribute('stroke', '#6250d6')

    // 7. filters
    await page.getByLabel('Filter by category').selectOption({ label: 'Food' })
    await expect(page.getByTestId('tx-row')).toHaveCount(1)
    await expect(page.getByTestId('tx-count')).toHaveText('Showing 1 of 4')
    await page.getByLabel('Filter by category').selectOption({ label: 'All categories' })
    await page.getByLabel('Filter by type').selectOption('income')
    await expect(page.getByTestId('tx-row')).toHaveCount(1)
    await expect(page.getByTestId('tx-row')).toContainText('Salary')
    await page.getByLabel('Filter by type').selectOption('')
    await page.getByLabel('Search notes').fill('VET')
    await expect(page.getByTestId('tx-row')).toHaveCount(1)
    await page.getByLabel('Search notes').fill('zzz')
    await expect(page.getByText('No transactions match the filters.')).toBeVisible()
    const clear = page.getByRole('button', { name: 'Clear filters' })
    await expect(clear).toBeEnabled()
    await clear.click()
    await expect(page.getByTestId('tx-row')).toHaveCount(4)
    await expect(clear).toBeDisabled()
    // Clear filters resets all three at once, and sits on the same row as the search box
    await page.getByLabel('Filter by category').selectOption({ label: 'Other' })
    await page.getByLabel('Filter by type').selectOption('income')
    await page.getByLabel('Search notes').fill('sal')
    await expect(page.getByTestId('tx-count')).toHaveText('Showing 1 of 4')
    const searchBox = (await page.getByLabel('Search notes').boundingBox())!
    const clearBox = (await clear.boundingBox())!
    expect(Math.abs(searchBox.y - clearBox.y)).toBeLessThan(4)
    expect(clearBox.x).toBeGreaterThan(searchBox.x + searchBox.width)
    await page.screenshot({ path: `shots/${size.name}-filters-active.png`, fullPage: true })
    await clear.click()
    await expect(page.getByLabel('Filter by category')).toHaveValue('')
    await expect(page.getByLabel('Filter by type')).toHaveValue('')
    await expect(page.getByLabel('Search notes')).toHaveValue('')
    await expect(page.getByTestId('tx-row')).toHaveCount(4)
    // income is teal (Tailwind teal-700) in the total and in the list
    const teal = 'oklch(0.511 0.096 186.391)'
    await expect(page.getByTestId('total-income')).toHaveCSS('color', teal)
    await expect(page.getByTestId('tx-row').filter({ hasText: 'Salary' }).getByTestId('tx-amount')).toHaveCSS('color', teal)
    // totals stay month-wide while filtering
    await expect(page.getByTestId('total-expenses')).toHaveText('842.65')

    await page.screenshot({ path: `shots/${size.name}-filled.png`, fullPage: true })

    // 8. CSV export
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()])
    expect(download.suggestedFilename()).toBe(`budget-${thisMonth}.csv`)
    const csv = readFileSync(await download.path(), 'utf8').replace(/^﻿/, '')
    expect(csv.split('\r\n')).toEqual([
      'Date,Type,Category,Amount,Note',
      `${day(1)},income,Other,3000.00,Salary`,
      `${day(2)},expense,Food,0.15,Flat white`,
      `${day(4)},expense,Housing,800.00,Rent`,
      `${day(5)},expense,Pets,42.50,Vet visit`,
      '',
    ])

    // 3. month switcher
    const label = await page.getByTestId('month-label').textContent()
    await page.getByRole('button', { name: 'Next month' }).click()
    await expect(page.getByTestId('month-label')).not.toHaveText(label!)
    await expect(page.getByTestId('total-income')).toHaveText('0.00')
    await expect(page.getByTestId('total-expenses')).toHaveText('0.00')
    await expect(page.getByTestId('donut-empty')).toBeVisible()
    await expect(page.getByTestId('budget-Food')).toContainText('0.00 / 0.25')
    await expect(page.getByTestId('tx-row')).toHaveCount(0)
    // adding in next month defaults to the 1st of that month
    await expect(page.getByRole('form', { name: 'Add transaction' }).getByLabel('Date')).toHaveValue(/-01$/)
    await page.getByRole('button', { name: 'Previous month' }).click()
    await page.getByRole('button', { name: 'Previous month' }).click()
    await expect(page.getByTestId('tx-row')).toHaveCount(0)
    await page.getByRole('button', { name: 'Today' }).click()
    await expect(page.getByTestId('month-label')).toHaveText(label!)
    await expect(page.getByTestId('tx-row')).toHaveCount(4)

    // a transaction dated in another month leaves this view and appears there
    await page.getByRole('button', { name: 'Edit Rent' }).click()
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 15)
    await page.getByRole('form', { name: 'Edit transaction' }).getByLabel('Date').fill(`${prev.getFullYear()}-${pad(prev.getMonth() + 1)}-15`)
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('status')).toContainText('moved to')
    await expect(page.getByTestId('tx-row')).toHaveCount(3)
    await page.getByRole('button', { name: 'Previous month' }).click()
    await expect(page.getByTestId('tx-row')).toHaveCount(1)
    await expect(page.getByTestId('total-expenses')).toHaveText('800.00')
    await page.getByRole('button', { name: 'Today' }).click()

    // 11. persistence
    await page.reload()
    await expect(page.getByTestId('tx-row')).toHaveCount(3)
    await expect(page.getByTestId('total-expenses')).toHaveText('42.65')
    await expect(page.getByTestId('cat-row-Pets')).toBeVisible()
    await expect(page.getByLabel('Monthly budget for Food')).toHaveValue('0.25')

    // layout: no horizontal scroll
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await page.screenshot({ path: `shots/${size.name}-final.png`, fullPage: true })
    expect(errors).toEqual([])
  })
}
