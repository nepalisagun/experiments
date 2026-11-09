import { expect, test, type Page } from '@playwright/test'

const sizes = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
]

const goMonth = (page: Page, ym: string) => page.locator('#month').fill(ym)
const rows = (page: Page) => page.getByTestId('tx-row')
const row = (page: Page, text: string) => rows(page).filter({ hasText: text })
const storedCount = (page: Page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem('budget-tracker:v1') ?? '{}').transactions ?? []).length as number)

async function addTx(page: Page, o: { type?: 'Income' | 'Expense'; amount: string; category: string; date: string; note: string; repeat: boolean }) {
  const form = page.getByRole('form', { name: 'Add transaction' })
  await form.getByText(o.type ?? 'Expense', { exact: true }).click()
  await form.getByLabel('Amount').fill(o.amount)
  await form.getByLabel('Date').fill(o.date)
  await form.getByLabel('Category').selectOption({ label: o.category })
  await form.getByLabel(/Note/).fill(o.note)
  await form.getByLabel('Repeat monthly').setChecked(o.repeat)
  if (o.repeat) await expect(form.getByText('It will appear in every later month you open, on the same day.')).toBeVisible()
  await form.getByRole('button', { name: 'Add transaction' }).click()
  await expect(form.getByLabel('Repeat monthly')).not.toBeChecked()
}

for (const size of sizes) {
  test(`recurring transactions at ${size.name} (${size.width}px)`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height })
    const dialogs: string[] = []
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.accept() })
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()

    // Mark as repeating when adding
    await goMonth(page, '2030-01')
    await expect(page.getByTestId('month-label')).toHaveText('January 2030')
    await addTx(page, { amount: '1200', category: 'Housing', date: '2030-01-31', note: 'Rent', repeat: true })
    await expect(page.getByRole('status').first()).toContainText('It repeats monthly.')
    await addTx(page, { type: 'Income', amount: '3000', category: 'Other', date: '2030-01-15', note: 'Salary', repeat: true })
    await addTx(page, { amount: '4.50', category: 'Food', date: '2030-01-20', note: 'Coffee', repeat: false })
    await expect(rows(page)).toHaveCount(3)
    await expect(page.getByTestId('tx-repeat-badge')).toHaveCount(2)
    await expect(row(page, 'Coffee').getByTestId('tx-repeat-badge')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Recurring (2)' })).toBeVisible()

    // Appears in later months on the same day, clamped to the last day of short months
    await page.getByRole('button', { name: 'Next month' }).click()
    await expect(page.getByTestId('month-label')).toHaveText('February 2030')
    await expect(rows(page)).toHaveCount(2)
    await expect(row(page, 'Rent')).toContainText('Feb 28')
    await expect(row(page, 'Salary')).toContainText('Feb 15')
    await expect(row(page, 'Coffee')).toHaveCount(0)
    await expect(page.getByTestId('total-income')).toHaveText('3,000.00')
    await expect(page.getByTestId('total-expenses')).toHaveText('1,200.00')
    await page.getByRole('button', { name: 'Next month' }).click()
    await expect(row(page, 'Rent')).toContainText('Mar 31')
    await page.getByRole('button', { name: 'Next month' }).click()
    await expect(row(page, 'Rent')).toContainText('Apr 30')
    await expect(rows(page)).toHaveCount(2)
    await page.screenshot({ path: `shots/${size.name}-rec-april.png`, fullPage: true })

    // Leap year: open Feb 2032 directly
    await goMonth(page, '2032-02')
    await expect(row(page, 'Rent')).toContainText('Feb 29')

    // No duplicates when reopening months, across navigation and a reload
    await goMonth(page, '2030-02')
    await goMonth(page, '2030-03')
    await goMonth(page, '2030-02')
    await expect(rows(page)).toHaveCount(2)
    const before = await storedCount(page)
    expect(before).toBe(3 + 2 * 4) // Jan + Feb, Mar, Apr 2030 + Feb 2032
    await page.reload()
    await goMonth(page, '2030-03')
    await expect(rows(page)).toHaveCount(2)
    await goMonth(page, '2030-01')
    await expect(rows(page)).toHaveCount(3)
    expect(await storedCount(page)).toBe(before)

    // Editing an occurrence updates it and later months, not earlier ones; the 31st stays the 31st
    await goMonth(page, '2030-02')
    await page.getByRole('button', { name: 'Edit Rent' }).click()
    const edit = page.getByRole('form', { name: 'Edit transaction' })
    await expect(edit.getByLabel('Repeat monthly')).toBeChecked()
    await expect(edit.getByText('Changes also apply to later months. Earlier months stay as they are.')).toBeVisible()
    await edit.getByLabel('Date').fill('2030-03-05')
    await edit.getByRole('button', { name: 'Save changes' }).click()
    await expect(edit.getByText(/A repeating transaction stays in February 2030/)).toBeVisible()
    await edit.getByLabel('Date').fill('2030-02-28')
    await edit.getByLabel('Amount').fill('1250')
    await page.screenshot({ path: `shots/${size.name}-rec-edit.png`, fullPage: true })
    await edit.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('status').first()).toContainText('Later months updated too.')
    await expect(row(page, 'Rent')).toContainText('1,250.00')
    await goMonth(page, '2030-03')
    await expect(row(page, 'Rent')).toContainText('1,250.00')
    await expect(row(page, 'Rent')).toContainText('Mar 31')
    await goMonth(page, '2030-01')
    await expect(row(page, 'Rent')).toContainText('1,200.00')

    // Deleting one occurrence doesn't delete the series and it doesn't come back
    await goMonth(page, '2030-04')
    await page.getByRole('button', { name: 'Delete Salary' }).click()
    expect(dialogs.at(-1)).toContain('from April 2030 only')
    await expect(row(page, 'Salary')).toHaveCount(0)
    await goMonth(page, '2030-05')
    await expect(row(page, 'Salary')).toHaveCount(1)
    await goMonth(page, '2030-04')
    await expect(row(page, 'Salary')).toHaveCount(0)

    // Recurring screen lists all repeating transactions
    await page.getByRole('link', { name: 'Recurring (2)' }).click()
    await expect(page).toHaveURL(/#\/recurring$/)
    await expect(page.getByRole('heading', { name: 'Repeating transactions' })).toBeVisible()
    await expect(page.getByLabel('Month')).toHaveCount(0)
    const recRows = page.getByTestId('rec-row')
    await expect(recRows).toHaveCount(2)
    const rentRec = recRows.filter({ hasText: 'Rent' })
    await expect(rentRec).toContainText('Monthly on the 31st (last day in shorter months)')
    await expect(rentRec).toContainText('1,250.00')
    await expect(rentRec.getByTestId('rec-status')).toHaveText('Repeating · since January 2030')
    await expect(recRows.filter({ hasText: 'Salary' })).toContainText('Monthly on the 15th')

    // Stop validation
    const salaryRec = recRows.filter({ hasText: 'Salary' })
    await salaryRec.getByRole('button', { name: 'Stop: Salary' }).click()
    await salaryRec.getByLabel('Stop from').fill('2029-11')
    await salaryRec.getByRole('button', { name: 'Stop repeating' }).click()
    await expect(salaryRec.getByRole('alert')).toHaveText('Choose January 2030 or later; it starts then.')
    await salaryRec.getByRole('button', { name: 'Cancel' }).click()

    // Stop Rent from March 2030
    await rentRec.getByRole('button', { name: 'Stop: Rent' }).click()
    await rentRec.getByLabel('Stop from').fill('2030-03')
    await expect(rentRec).toContainText('Removed from March 2030 onward. January 2030 to February 2030 stay unchanged.')
    await page.screenshot({ path: `shots/${size.name}-rec-stop.png`, fullPage: true })
    await rentRec.getByRole('button', { name: 'Stop repeating' }).click()
    await expect(page.getByRole('status')).toContainText('Stopped from March 2030 on. Earlier months are unchanged.')
    await expect(rentRec.getByTestId('rec-status')).toHaveText('Stopped · January 2030 – February 2030')
    await expect(page.getByRole('link', { name: 'Recurring (1)' })).toBeVisible()

    // Earlier months unchanged, chosen month and later cleared, never regenerated
    await page.getByRole('link', { name: 'Overview' }).click()
    await expect(page.getByTestId('month-label')).toHaveText('April 2030')
    await expect(row(page, 'Rent')).toHaveCount(0)
    await goMonth(page, '2030-03')
    await expect(row(page, 'Rent')).toHaveCount(0)
    await expect(row(page, 'Salary')).toHaveCount(1)
    await goMonth(page, '2030-09')
    await expect(row(page, 'Rent')).toHaveCount(0)
    await expect(row(page, 'Salary')).toContainText('Sep 15')
    await goMonth(page, '2032-02')
    await expect(row(page, 'Rent')).toHaveCount(0)
    await goMonth(page, '2030-02')
    await expect(row(page, 'Rent')).toContainText('1,250.00')
    await goMonth(page, '2030-01')
    await expect(row(page, 'Rent')).toContainText('1,200.00')
    await expect(row(page, 'Coffee')).toHaveCount(1)

    // Unticking "Repeat monthly" while editing ends the series after that month
    await goMonth(page, '2030-06')
    await page.getByRole('button', { name: 'Edit Salary' }).click()
    await page.getByRole('form', { name: 'Edit transaction' }).getByLabel('Repeat monthly').uncheck()
    await expect(page.getByText('Unticked: it stops repeating after June 2030.')).toBeVisible()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('status').first()).toContainText('It no longer repeats.')
    await goMonth(page, '2030-07')
    await expect(row(page, 'Salary')).toHaveCount(0)
    await goMonth(page, '2030-09')
    await expect(row(page, 'Salary')).toHaveCount(0)

    // Ticking repeat on a one-off transaction while editing starts a series
    await goMonth(page, '2030-01')
    await page.getByRole('button', { name: 'Edit Coffee' }).click()
    await page.getByRole('form', { name: 'Edit transaction' }).getByLabel('Repeat monthly').check()
    await page.getByRole('button', { name: 'Save changes' }).click()
    await goMonth(page, '2030-02')
    await expect(row(page, 'Coffee')).toContainText('Feb 20')

    // Recurring screen survives a reload; stopping from the first month removes it everywhere
    await page.getByRole('link', { name: /Recurring/ }).click()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Repeating transactions' })).toBeVisible()
    await expect(page.getByTestId('rec-row')).toHaveCount(3)
    await expect(page.getByTestId('rec-row').filter({ hasText: 'Salary' }).getByTestId('rec-status')).toHaveText('Stopped · January 2030 – June 2030')
    const coffeeRec = page.getByTestId('rec-row').filter({ hasText: 'Coffee' })
    await coffeeRec.getByRole('button', { name: 'Stop: Coffee' }).click()
    await coffeeRec.getByLabel('Stop from').fill('2030-01')
    await expect(coffeeRec).toContainText('It starts this month, so it will be removed from every month.')
    await coffeeRec.getByRole('button', { name: 'Stop repeating' }).click()
    expect(dialogs.at(-1)).toContain('deletes it from every month')
    await expect(page.getByTestId('rec-row')).toHaveCount(2)
    let overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await page.screenshot({ path: `shots/${size.name}-rec-list.png`, fullPage: true })

    await page.getByRole('link', { name: 'Overview' }).click()
    await goMonth(page, '2030-01')
    await expect(row(page, 'Coffee')).toHaveCount(0)
    await expect(rows(page)).toHaveCount(2)
    overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await page.screenshot({ path: `shots/${size.name}-rec-jan.png`, fullPage: true })
    expect(errors).toEqual([])
  })
}
