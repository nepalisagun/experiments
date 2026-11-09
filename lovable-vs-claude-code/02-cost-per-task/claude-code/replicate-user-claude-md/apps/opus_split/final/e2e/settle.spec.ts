import { expect, test, type Page } from '@playwright/test'

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `shots/${test.info().project.name}-${name}.png`, fullPage: true })

async function addPerson(page: Page, name: string) {
  await page.getByLabel("New person's name").fill(name)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
}

async function addItem(page: Page, name: string, price: string, people: string[]) {
  const form = page.getByRole('form', { name: 'Add item' })
  await form.getByLabel('Item').fill(name)
  await form.getByLabel('Price').fill(price)
  for (const p of people) await form.getByRole('checkbox', { name: p }).check()
  await form.getByRole('button', { name: 'Add item' }).click()
}

const transfers = (page: Page) => page.getByTestId('transfer')
const settle = (page: Page) => page.getByRole('region', { name: 'Settle up' })
const paidBy = (page: Page) => page.getByRole('region', { name: 'Who paid' })

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

/** Anna 30, Ben 20, Cat 10; no tax, no tip: total $60.00. */
async function setUpDinner(page: Page) {
  for (const n of ['Anna', 'Ben', 'Cat']) await addPerson(page, n)
  await addItem(page, 'Steak', '30', ['Anna'])
  await addItem(page, 'Pasta', '20', ['Ben'])
  await addItem(page, 'Soup', '10', ['Cat'])
  await page.getByRole('button', { name: 'Custom' }).click()
  await page.getByLabel('Custom tip percentage').fill('0')
  await expect(page.getByTestId('bill-total')).toHaveText('$60.00')
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('payers, sum validation and settle-up transfers', async ({ page }) => {
  await setUpDinner(page)
  await expect(settle(page)).toContainText('Record who paid to see who owes whom.')

  // One payer, prefilled with the bill total
  await page.getByRole('button', { name: '+ Add payer' }).click()
  await expect(page.getByLabel('Payer 1')).toHaveValue(/.+/)
  await expect(page.getByLabel('Amount paid by Anna')).toHaveValue('60.00')
  await expect(page.getByTestId('payments-status')).toHaveText('✓ Payments add up to the bill total of $60.00.')
  await expect(transfers(page)).toHaveText(['Ben pays Anna $20.00', 'Cat pays Anna $10.00'])
  await expect(settle(page)).toContainText('2 transfers, the fewest needed')

  // Short: clear message, no transfers
  await page.getByLabel('Amount paid by Anna').fill('40')
  await expect(paidBy(page).getByRole('alert')).toContainText('Payments add up to $40.00, but the bill total is $60.00. $20.00 is still unpaid.')
  await expect(transfers(page)).toHaveCount(0)
  await expect(settle(page)).toContainText('Transfers will appear once the payments add up to the bill total.')
  await shot(page, 'payments-short')

  // Second payer is prefilled with what's left, and only offers people not already paying
  await page.getByRole('button', { name: '+ Add payer' }).click()
  const payer2 = page.getByLabel('Payer 2')
  await expect(payer2.locator('option')).toHaveText(['Ben', 'Cat'])
  await expect(page.getByLabel('Amount paid by Ben')).toHaveValue('20.00')
  await expect(transfers(page)).toHaveText(['Cat pays Anna $10.00'])
  await expect(settle(page)).toContainText('One transfer')

  // Over: message + one-click fix
  await page.getByLabel('Amount paid by Ben').fill('25')
  await expect(paidBy(page).getByRole('alert')).toContainText("Payments add up to $65.00, but the bill total is $60.00. That's $5.00 too much.")
  await page.getByRole('button', { name: "Set Ben's payment to $20.00" }).click()
  await expect(page.getByLabel('Amount paid by Ben')).toHaveValue('20.00')
  await expect(transfers(page)).toHaveText(['Cat pays Anna $10.00'])

  // Per-row validation
  await page.getByLabel('Amount paid by Ben').fill('-5')
  await expect(paidBy(page).getByText('Amount cannot be negative.')).toBeVisible()
  await expect(page.getByTestId('payments-status')).toHaveCount(0) // sum message waits for valid rows
  await page.getByLabel('Amount paid by Ben').fill('')
  await expect(paidBy(page).getByText('Enter the amount paid.')).toBeVisible()
  await page.getByLabel('Amount paid by Ben').fill('abc')
  await expect(paidBy(page).getByText('Amount must be a number, e.g. 12.50.')).toBeVisible()
  await page.getByLabel('Amount paid by Ben').fill('20')
  await expect(paidBy(page).getByRole('alert')).toHaveCount(0)

  // Switch payer 2 from Ben to Cat: Anna +10, Cat paid 20 owes 10 (+10), Ben owes 20
  await payer2.selectOption({ label: 'Cat' })
  await expect(page.getByLabel('Amount paid by Cat')).toHaveValue('20')
  await expect(transfers(page)).toHaveText(['Ben pays Anna $10.00', 'Ben pays Cat $10.00'])

  // Third payer: everyone listed -> button disabled
  await page.getByLabel('Amount paid by Anna').fill('30')
  await page.getByRole('button', { name: '+ Add payer' }).click()
  await expect(page.getByLabel('Amount paid by Ben')).toHaveValue('10.00')
  await expect(page.getByRole('button', { name: '+ Add payer' })).toBeDisabled()
  await page.getByLabel('Amount paid by Ben').fill('20')
  await page.getByLabel('Amount paid by Cat').fill('10')
  await expect(settle(page)).toContainText('Everyone is even. No transfers needed.')

  // Remove payers
  await page.getByRole('button', { name: 'Remove payment by Cat' }).click()
  await page.getByRole('button', { name: 'Remove payment by Ben' }).click()
  await expect(page.getByTestId('payment-row')).toHaveCount(1)
  await expect(paidBy(page).getByRole('alert')).toContainText('$30.00 is still unpaid.')
  await page.getByRole('button', { name: "Set Anna's payment to $60.00" }).click()
  await expect(transfers(page)).toHaveText(['Ben pays Anna $20.00', 'Cat pays Anna $10.00'])
  await shot(page, 'settle-up')
  await expectNoHorizontalScroll(page)
})

test('changing the bill after recording payments re-checks the total', async ({ page }) => {
  await setUpDinner(page)
  await page.getByRole('button', { name: '+ Add payer' }).click()
  await expect(transfers(page)).toHaveCount(2)
  await page.getByRole('button', { name: '20%' }).click() // total becomes $72.00
  await expect(page.getByTestId('bill-total')).toHaveText('$72.00')
  await expect(paidBy(page).getByRole('alert')).toContainText('$12.00 is still unpaid.')
  await expect(transfers(page)).toHaveCount(0)
  await page.getByRole('button', { name: "Set Anna's payment to $72.00" }).click()
  // tip is split in proportion too: Ben 20 + 4, Cat 10 + 2
  await expect(transfers(page)).toHaveText(['Ben pays Anna $24.00', 'Cat pays Anna $12.00'])
})

test('settle-up uses rounded per-person totals and the fewest transfers', async ({ page }) => {
  for (const n of ['Anna', 'Ben', 'Cat', 'Dan']) await addPerson(page, n)
  await addItem(page, 'Platter', '10', ['Anna', 'Ben', 'Cat'])
  await page.getByLabel('Tax', { exact: true }).fill('8.875')
  // 18% default tip; Dan had nothing and paid for everything
  const total = (await page.getByTestId('bill-total').textContent())!
  expect(total).toBe('$12.69')
  await page.getByRole('button', { name: '+ Add payer' }).click()
  await page.getByLabel('Payer 1').selectOption({ label: 'Dan' })
  await expect(page.getByLabel('Amount paid by Dan')).toHaveValue('12.69')
  const shares = await page.getByTestId('share-total').allTextContents()
  await expect(transfers(page)).toHaveText([`Anna pays Dan ${shares[0]}`, `Ben pays Dan ${shares[1]}`, `Cat pays Dan ${shares[2]}`])
  const cents = (s: string) => Math.round(Number(s.replace(/[^0-9.]/g, '')) * 100)
  const sum = (await transfers(page).allTextContents()).map((t) => cents(t.split(' Dan ')[1])).reduce((a, b) => a + b, 0)
  expect(sum).toBe(1269)
})

test('copy summary includes payers and transfers; currency applies', async ({ page }) => {
  await setUpDinner(page)
  await page.getByRole('button', { name: '+ Add payer' }).click()
  await page.getByLabel('Amount paid by Anna').fill('45')
  await page.getByRole('button', { name: '+ Add payer' }).click()
  // Ben's row is prefilled with the remaining $15. Owed: Anna 30, Ben 20, Cat 10.
  // Balances: Anna +15, Ben -5, Cat -10.
  await expect(page.getByLabel('Amount paid by Ben')).toHaveValue('15.00')
  await expect(transfers(page)).toHaveText(['Cat pays Anna $10.00', 'Ben pays Anna $5.00'])
  await page.getByLabel('Currency').selectOption('EUR')
  await expect(transfers(page)).toHaveText(['Cat pays Anna 10,00 €', 'Ben pays Anna 5,00 €'])
  await page.getByRole('button', { name: 'Copy summary' }).click()
  await expect(page.getByRole('status')).toHaveText('Summary copied to clipboard')
  const text = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')
  expect(text).toContain('Total: 60,00 €')
  expect(text.endsWith('Paid by:\n- Anna: 45,00 €\n- Ben: 15,00 €\n\nSettle up:\n- Cat pays Anna 10,00 €\n- Ben pays Anna 5,00 €')).toBe(true)
})

test('payments survive reload, removing a payer person asks first, reset clears them', async ({ page }) => {
  await setUpDinner(page)
  await page.getByRole('button', { name: '+ Add payer' }).click()
  await page.getByLabel('Amount paid by Anna').fill('50')
  await page.getByRole('button', { name: '+ Add payer' }).click()
  await expect(page.getByLabel('Amount paid by Ben')).toHaveValue('10.00')
  const before = await transfers(page).allTextContents()
  await page.reload()
  await expect(page.getByTestId('payment-row')).toHaveCount(2)
  await expect(page.getByLabel('Amount paid by Anna')).toHaveValue('50')
  await expect(transfers(page)).toHaveText(before)

  await page.getByRole('button', { name: 'Remove Ben' }).click()
  const dialog = page.getByRole('dialog', { name: 'Remove Ben?' })
  await expect(dialog).toContainText('Pasta')
  await expect(dialog).toContainText('Their payment will be removed too')
  await shot(page, 'remove-payer-dialog')
  await dialog.getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByTestId('payment-row')).toHaveCount(1)
  // total is now $40; Anna paid $50
  await expect(paidBy(page).getByRole('alert')).toContainText("That's $10.00 too much.")

  await page.getByRole('button', { name: 'Reset' }).click()
  await page.getByRole('dialog', { name: 'Reset the bill?' }).getByRole('button', { name: 'Reset' }).click()
  await expect(page.getByTestId('payment-row')).toHaveCount(0)
  await expect(paidBy(page)).toContainText('Add people first.')
  await expect(settle(page)).toContainText('Record who paid')
})
