import { expect, test, type Page } from '@playwright/test'

const sizes = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 375, height: 800 },
]

for (const size of sizes) {
  test.describe(`settle-up ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height }, permissions: ['clipboard-read', 'clipboard-write'] })

    const addPerson = async (page: Page, n: string) => {
      await page.getByLabel('New person name').fill(n)
      await page.getByRole('button', { name: 'Add person' }).click()
    }
    const addItem = async (page: Page, name: string, price: string, who: string[]) => {
      await page.getByLabel('Item name').fill(name)
      await page.getByLabel('Price').fill(price)
      for (const w of who) await page.getByRole('checkbox', { name: w }).check()
      await page.getByRole('button', { name: 'Add item' }).click()
    }
    const noHScroll = async (page: Page) =>
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

    test('who paid and settle up', async ({ page }) => {
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())
      await page.reload()

      // before anything exists
      await expect(page.getByRole('button', { name: 'Add payer' })).toBeDisabled()
      await expect(page.getByText('Nothing to settle yet.')).toBeVisible()

      for (const n of ['Ann', 'Ben', 'Cy']) await addPerson(page, n)
      await addItem(page, 'Pizza', '30', ['Ann', 'Ben'])
      await addItem(page, 'Wine', '20', ['Cy'])
      await page.getByLabel('Tax (%)').fill('10')
      await page.getByRole('button', { name: 'No tip' }).click()
      await expect(page.getByTestId('bill-total')).toHaveText('$55.00') // Ann 16.50, Ben 16.50, Cy 22.00
      await expect(page.getByText('Record who paid to see who owes whom.')).toBeVisible()

      // add payer: single payer paid too little
      await page.getByRole('button', { name: 'Add payer' }).click()
      await expect(page.getByTestId('payer-row')).toHaveCount(1)
      await expect(page.getByLabel('Payer 1')).toHaveValue(/.+/)
      await page.getByLabel('Amount paid by Ann').fill('40')
      await expect(page.getByText('Payments add up to $40.00, which is $15.00 less than the bill total of $55.00.')).toBeVisible()
      await expect(page.getByTestId('paid-progress')).toHaveText('Paid $40.00 of $55.00')
      await expect(page.getByText(/needs the payments to add up/)).toBeVisible()
      await expect(page.getByTestId('transfer')).toHaveCount(0)

      // too much
      await page.getByLabel('Amount paid by Ann').fill('60')
      await expect(page.getByText('Payments add up to $60.00, which is $5.00 more than the bill total of $55.00.')).toBeVisible()

      // row validation
      await page.getByLabel('Amount paid by Ann').fill('-5')
      await expect(page.getByText('Amount cannot be negative.')).toBeVisible()
      await page.getByLabel('Amount paid by Ann').fill('')
      await expect(page.getByText('Enter an amount.')).toBeVisible()
      await page.getByLabel('Amount paid by Ann').fill('1.999')
      await expect(page.getByText(/at most 2 decimal/)).toBeVisible()

      // two payers; the dropdown won't offer someone already listed
      await page.getByLabel('Amount paid by Ann').fill('40')
      await page.getByRole('button', { name: 'Add payer' }).click()
      await expect(page.getByLabel('Payer 2')).toHaveValue(/.+/)
      await expect(page.getByLabel('Payer 2').locator('option:checked')).toHaveText('Ben')
      await expect(page.getByLabel('Payer 2').locator('option', { hasText: 'Ann' })).toBeDisabled()
      // fill remaining -> 15.00, so the payments match
      await page.getByRole('button', { name: 'Fill remaining for Ben' }).click()
      await expect(page.getByLabel('Amount paid by Ben')).toHaveValue('15.00')
      await expect(page.getByText('Payments match the bill total.')).toBeVisible()

      // Ann +23.50, Ben -1.50, Cy -22.00
      const transfers = page.getByTestId('transfer')
      await expect(transfers).toHaveCount(2)
      await expect(transfers).toContainText(['Cy pays Ann $22.00', 'Ben pays Ann $1.50'])
      await noHScroll(page)
      await page.screenshot({ path: `shots/${size.name}-settle.png`, fullPage: true })

      // third payer not possible when everyone is listed after adding Cy
      await page.getByRole('button', { name: 'Add payer' }).click()
      await expect(page.getByRole('button', { name: 'Add payer' })).toBeDisabled()
      await expect(page.getByLabel('Payer 3').locator('option:checked')).toHaveText('Cy')
      await page.getByLabel('Amount paid by Cy').fill('0')
      await expect(page.getByText('Amount must be greater than zero.')).toBeVisible()
      await page.getByRole('button', { name: 'Remove payer Cy' }).click()
      await expect(page.getByTestId('payer-row')).toHaveCount(2)

      // editing the bill re-checks the payments: adding an item makes them short
      await addItem(page, 'Dessert', '10', ['Cy'])
      await expect(page.getByText(/less than the bill total of \$66\.00/)).toBeVisible()
      await expect(page.getByTestId('transfer')).toHaveCount(0)
      await page.getByRole('button', { name: 'Remove Dessert' }).click()
      await expect(page.getByTestId('transfer')).toHaveCount(2)

      // currency formatting follows the selector
      await page.getByLabel('Currency').selectOption('EUR')
      await expect(transfers.first()).toContainText('€')
      await expect(transfers).toContainText(['Cy pays Ann 22,00', 'Ben pays Ann 1,50'])
      await page.getByLabel('Currency').selectOption('USD')

      // copied summary has the transfers
      await page.getByRole('button', { name: 'Copy summary' }).click()
      await expect(page.getByRole('status')).toContainText('copied')
      // the Windows clipboard turns \n into \r\n
      const clip = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')
      expect(clip).toContain('Paid by:\n- Ann: $40.00\n- Ben: $15.00')
      expect(clip).toContain('Settle up:\n- Cy pays Ann $22.00\n- Ben pays Ann $1.50')

      // survives a reload
      await page.reload()
      await expect(page.getByTestId('payer-row')).toHaveCount(2)
      await expect(page.getByLabel('Amount paid by Ann')).toHaveValue('40')
      await expect(page.getByTestId('transfer')).toHaveCount(2)

      // summary explains a broken payment state
      await page.getByLabel('Amount paid by Ben').fill('5')
      await page.getByRole('button', { name: 'Copy summary' }).click()
      await expect(page.getByRole('status')).toContainText('copied')
      expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Settle up: not available. Payments add up to $45.00')
      await page.getByLabel('Amount paid by Ben').fill('15')

      // removing a person removes their payment too
      await page.getByRole('button', { name: 'Remove Ben' }).click()
      await expect(page.getByTestId('payer-row')).toHaveCount(1)
      await expect(page.getByText(/less than the bill total/)).toBeVisible()

      // reset clears the payers
      await page.getByRole('button', { name: 'Reset' }).click()
      await page.getByRole('button', { name: 'Yes, reset' }).click()
      await expect(page.getByTestId('payer-row')).toHaveCount(0)
      await page.reload()
      await expect(page.getByTestId('payer-row')).toHaveCount(0)
      await noHScroll(page)
    })

    test('everyone paid their own share: all square', async ({ page }) => {
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())
      await page.reload()
      await addPerson(page, 'Ann')
      await addPerson(page, 'Ben')
      await addItem(page, 'Soup', '10', ['Ann'])
      await addItem(page, 'Stew', '10', ['Ben'])
      await page.getByRole('button', { name: 'No tip' }).click()
      await page.getByRole('button', { name: 'Add payer' }).click()
      await page.getByRole('button', { name: 'Fill remaining for Ann' }).click()
      await page.getByLabel('Amount paid by Ann').fill('10')
      await page.getByRole('button', { name: 'Add payer' }).click()
      await page.getByRole('button', { name: 'Fill remaining for Ben' }).click()
      await expect(page.getByText('All square. Nobody owes anything.')).toBeVisible()
      await page.getByRole('button', { name: 'Copy summary' }).click()
      expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('All square, no transfers needed.')
    })
  })
}
