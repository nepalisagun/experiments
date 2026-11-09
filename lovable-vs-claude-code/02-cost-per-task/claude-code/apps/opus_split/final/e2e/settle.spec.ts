import { expect, test, type Page } from '@playwright/test'

async function addPerson(page: Page, name: string) {
  await page.getByLabel('Person name').fill(name)
  await page.getByRole('button', { name: 'Add person' }).click()
}

async function addItem(page: Page, name: string, price: string, onlyFor?: string[]) {
  await page.getByLabel('Item name').fill(name)
  await page.getByLabel(/^Price/).fill(price)
  if (onlyFor) {
    const form = page.getByRole('form', { name: /item/i })
    const toggle = form.getByRole('button', { name: /Select all|Clear all/ })
    if ((await toggle.textContent()) === 'Clear all') await toggle.click()
    for (const n of onlyFor) await form.locator('label', { hasText: new RegExp(`^[✓+]${n}$`) }).click()
  }
  await page.getByRole('button', { name: 'Add item' }).click()
}

const transfers = (page: Page) => page.getByTestId('transfer')
const amount = (page: Page, n: number) => page.getByLabel(new RegExp(`^Amount paid by payer ${n}`))

for (const size of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
]) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } })

    test('who paid + settle up', async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())
      await page.reload()
      const shot = (n: string) => page.screenshot({ path: `shots/${size.name}-settle-${n}.png`, fullPage: true })

      // Before anything: helpful empty states
      await expect(page.getByRole('button', { name: 'Add payer' })).toBeDisabled()
      await expect(page.getByText('Add who paid to see who owes whom.')).toBeVisible()

      for (const n of ['Anna', 'Ben', 'Cara']) await addPerson(page, n)
      await addItem(page, 'Pizza', '30')
      await addItem(page, 'Wine', '20', ['Anna'])
      await addItem(page, 'Salad', '12', ['Ben', 'Cara'])
      await page.getByRole('button', { name: '18%' }).click() // toggle the default tip off -> total 62.00
      await expect(page.getByTestId('grand-total')).toHaveText('$62.00')
      // owed: Anna 30, Ben 16, Cara 16

      // One payer: prefilled with the whole bill
      await page.getByRole('button', { name: 'Add payer' }).click()
      await expect(page.getByLabel('Payer 1', { exact: true })).toHaveValue(/.+/)
      await expect(page.getByLabel('Payer 1', { exact: true }).locator('option:checked')).toHaveText('Anna')
      await expect(amount(page, 1)).toHaveValue('62.00')
      await expect(page.getByTestId('payments-ok')).toBeVisible()
      await expect(transfers(page)).toHaveText(['Ben pays Anna $16.00', 'Cara pays Anna $16.00'])

      // Amounts that don't add up -> clear message, settle-up hidden
      await amount(page, 1).fill('40')
      await expect(page.getByTestId('payments-error')).toHaveText(
        'Payments add up to $40.00, but the bill total is $62.00. $22.00 is still unaccounted for.',
      )
      await expect(page.getByTestId('settle-blocked')).toBeVisible()
      await expect(transfers(page)).toHaveCount(0)
      await shot('short')

      // Second payer: prefilled with what's left
      await page.getByRole('button', { name: 'Add payer' }).click()
      await expect(page.getByLabel('Payer 2', { exact: true }).locator('option:checked')).toHaveText('Ben')
      await expect(amount(page, 2)).toHaveValue('22.00')
      // Anna can't be picked twice
      await expect(page.getByLabel('Payer 2', { exact: true }).locator('option', { hasText: 'Anna' })).toBeDisabled()
      // Anna +10, Ben +6, Cara -16
      await expect(transfers(page)).toHaveText(['Cara pays Anna $10.00', 'Cara pays Ben $6.00'])
      await shot('two-payers')

      // Overpaying
      await amount(page, 2).fill('30')
      await expect(page.getByTestId('payments-error')).toHaveText(
        'Payments add up to $70.00, which is $8.00 more than the bill total of $62.00.',
      )
      await expect(page.getByTestId('paid-progress')).toHaveText('Paid $70.00 of $62.00')
      // "Pays the rest" fixes it
      await page.getByRole('button', { name: 'Pays the rest' }).nth(1).click()
      await expect(amount(page, 2)).toHaveValue('22.00')
      await expect(page.getByTestId('payments-ok')).toBeVisible()

      // Row-level validation
      await amount(page, 2).fill('-5')
      await expect(page.getByText('Amount cannot be negative.')).toBeVisible()
      await expect(page.getByTestId('settle-blocked')).toBeVisible()
      await amount(page, 2).fill('abc')
      await expect(page.getByText('Amount must be a number, e.g. 12.50.')).toBeVisible()
      await amount(page, 2).fill('')
      await expect(page.getByText('Enter an amount.')).toBeVisible()
      await amount(page, 2).fill('22')
      await expect(transfers(page)).toHaveCount(2)

      // Tax/tip changes flow through: the bill total moves, so payments no longer match
      await page.getByLabel('Tax (%)').fill('10')
      await expect(page.getByTestId('payments-error')).toContainText('$6.20 is still unaccounted for')
      await page.getByRole('button', { name: 'Pays the rest' }).nth(1).click()
      await expect(amount(page, 2)).toHaveValue('28.20')
      // owed: Anna 33.00, Ben 17.60, Cara 17.60 ; paid Anna 40, Ben 28.20
      await expect(transfers(page)).toHaveText(['Cara pays Anna $7.00', 'Cara pays Ben $10.60'])

      // Copy summary includes payers and transfers
      await page.getByRole('button', { name: 'Copy summary' }).click()
      await expect(page.getByText('Summary copied to clipboard.')).toBeVisible()
      // Windows' clipboard hands text back with CRLF line endings.
      const clip = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')
      expect(clip).toContain('Paid:\n  Anna: $40.00\n  Ben: $28.20')
      expect(clip).toContain('Settle up:\n  Cara pays Anna $7.00\n  Cara pays Ben $10.60')

      // Currency changes the transfer formatting
      await page.getByLabel('Currency').selectOption('PLN')
      await expect(transfers(page)).toHaveText(['Cara pays Anna 7,00 zł', 'Cara pays Ben 10,60 zł'])
      await shot('pln')

      // Survives reload
      await page.reload()
      await expect(page.getByTestId('payer-row')).toHaveCount(2)
      await expect(amount(page, 2)).toHaveValue('28.20')
      await expect(transfers(page)).toHaveText(['Cara pays Anna 7,00 zł', 'Cara pays Ben 10,60 zł'])

      // Everyone even: each pays exactly their own share
      await amount(page, 1).fill('33')
      await amount(page, 2).fill('17.60')
      await page.getByRole('button', { name: 'Add payer' }).click()
      await expect(page.getByLabel('Payer 3', { exact: true }).locator('option:checked')).toHaveText('Cara')
      await expect(amount(page, 3)).toHaveValue('17.60')
      await expect(page.getByText('Everyone is even. No transfers needed.')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Add payer' })).toBeDisabled() // everyone is already a payer

      // Removing a person who paid un-assigns their payment with a clear message
      await page.getByRole('button', { name: 'Remove payer 3' }).click()
      await page.getByRole('button', { name: 'Remove Ben' }).click()
      await expect(page.getByText('Choose who paid.')).toBeVisible()
      await expect(page.getByTestId('settle-blocked')).toBeVisible()
      await shot('removed-payer')

      // No horizontal scroll
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow).toBeLessThanOrEqual(0)

      // Reset clears payers too
      await page.getByRole('button', { name: 'Reset' }).click()
      await page.getByRole('button', { name: 'Yes, reset' }).click()
      await expect(page.getByTestId('payer-row')).toHaveCount(0)
      await expect(page.getByText('Add who paid to see who owes whom.')).toBeVisible()
    })
  })
}
