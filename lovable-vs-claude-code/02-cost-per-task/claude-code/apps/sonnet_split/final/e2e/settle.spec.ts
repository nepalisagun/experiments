import { expect, test, type Page } from '@playwright/test'

const sizes = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 375, height: 700 },
]

async function addPerson(page: Page, name: string) {
  await page.getByLabel('Person name').fill(name)
  await page.getByRole('button', { name: 'Add', exact: true }).click()
}
async function addItem(page: Page, name: string, price: string, people: string[]) {
  await page.getByLabel('Item', { exact: true }).fill(name)
  await page.getByLabel('Price').fill(price)
  for (const p of people) await page.getByLabel(p, { exact: true }).check()
  await page.getByRole('button', { name: 'Add item' }).click()
}
const noHScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

for (const size of sizes) {
  test(`who paid and settle up @ ${size.name}`, async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      permissions: ['clipboard-read', 'clipboard-write'],
    })
    const page = await ctx.newPage()
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()

    // empty states
    await expect(page.getByText('Add people first.').first()).toBeVisible()
    await addPerson(page, 'Ann')
    await addPerson(page, 'Bob')
    await addPerson(page, 'Cy')
    await page.getByLabel('Custom %').fill('0')
    await addItem(page, 'Pizza', '30', ['Ann', 'Bob', 'Cy'])
    await addItem(page, 'Wine', '24.80', ['Ann'])
    await expect(page.getByTestId('grand-total')).toHaveText('$54.80')
    await expect(page.getByTestId('settle-hint')).toContainText('Add who paid')

    // single payer, amount prefilled with what is still unaccounted for
    await page.getByRole('button', { name: 'Add payer' }).click()
    await expect(page.getByLabel('Payer 1')).toHaveValue(/.+/)
    await expect(page.getByLabel('Amount paid by Ann')).toHaveValue('54.80')
    await expect(page.getByTestId('payment-status')).toContainText('add up to the bill total')
    await expect(page.getByTestId('transfer')).toHaveText(['Bob pays Ann $10.00', 'Cy pays Ann $10.00'])

    // mismatch messages: short, over, invalid
    await page.getByLabel('Amount paid by Ann').fill('50')
    await expect(page.getByTestId('payment-status')).toHaveText(
      'Payments add up to $50.00, but the bill total is $54.80. $4.80 is still unaccounted for.',
    )
    await expect(page.getByTestId('transfer')).toHaveCount(0)
    await expect(page.getByTestId('settle-hint')).toContainText('unaccounted for')
    await page.getByLabel('Amount paid by Ann').fill('60')
    await expect(page.getByTestId('payment-status')).toContainText('$5.20 too much')
    await page.getByLabel('Amount paid by Ann').fill('-5')
    await expect(page.getByText('Amount cannot be negative.')).toBeVisible()
    await page.getByLabel('Amount paid by Ann').fill('')
    await expect(page.getByText('Enter the amount paid.')).toBeVisible()
    await page.getByLabel('Amount paid by Ann').fill('abc')
    await expect(page.getByText('Amount must be a number')).toBeVisible()
    await expect(page.getByTestId('settle-hint')).toContainText('Fix the amounts')

    // two payers that sum to the total
    await page.getByLabel('Amount paid by Ann').fill('30')
    await page.getByRole('button', { name: 'Add payer' }).click()
    await expect(page.getByLabel('Amount paid by Bob')).toHaveValue('24.80')
    await expect(page.getByTestId('payment-status')).toContainText('add up to the bill total')
    await expect(page.getByTestId('transfer')).toHaveText(['Cy pays Bob $10.00', 'Ann pays Bob $4.80'])
    // a person can only be a payer once
    await page.getByRole('button', { name: 'Add payer' }).click()
    await expect(page.getByTestId('payer')).toHaveCount(3)
    await expect(page.getByRole('button', { name: 'Add payer' })).toBeDisabled()
    await page.getByRole('button', { name: 'Remove payer Cy' }).click()
    await expect(page.getByTestId('payer')).toHaveCount(2)

    // currency formatting flows through
    await page.getByLabel('Currency').selectOption('EUR')
    await expect(page.getByTestId('transfer').nth(1)).toContainText('Ann pays Bob 4,80')

    // changing the bill re-checks the payments
    await page.getByLabel('Currency').selectOption('USD')
    await addItem(page, 'Dessert', '6', ['Cy'])
    await expect(page.getByTestId('payment-status')).toContainText('$6.00 is still unaccounted for')
    await page.getByRole('button', { name: 'Remove item Dessert' }).click()
    await expect(page.getByTestId('transfer')).toHaveCount(2)

    // copied summary includes the transfers
    await page.getByRole('button', { name: 'Copy summary' }).click()
    await expect(page.getByText('Copied to clipboard!')).toBeVisible()
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toContain('Settle up:')
    expect(clip).toContain('Cy pays Bob $10.00')
    expect(clip).toContain('Ann pays Bob $4.80')
    expect(clip).toContain('Paid by:')

    await noHScroll(page)
    await page.screenshot({ path: `shots/${size.name}-settle.png`, fullPage: true })

    // persistence
    await page.reload()
    await expect(page.getByTestId('payer')).toHaveCount(2)
    await expect(page.getByLabel('Amount paid by Ann')).toHaveValue('30')
    await expect(page.getByTestId('transfer')).toHaveCount(2)

    // removing a payer's person removes the payer row
    await page.getByRole('button', { name: 'Remove Bob' }).click()
    await expect(page.getByTestId('payer')).toHaveCount(1)
    await expect(page.getByTestId('payment-status')).toContainText('unaccounted for')

    // reset clears payers
    await page.getByRole('button', { name: 'Reset' }).click()
    await page.getByRole('button', { name: 'Yes, reset' }).click()
    await page.reload()
    await expect(page.getByTestId('payer')).toHaveCount(0)
    await ctx.close()
  })
}
