import { expect, test, type Page } from '@playwright/test'

const sizes = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 375, height: 800 },
]

for (const size of sizes) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height }, permissions: ['clipboard-read', 'clipboard-write'] })

    const addPerson = async (page: Page, n: string) => {
      await page.getByLabel('New person name').fill(n)
      await page.getByRole('button', { name: 'Add person' }).click()
    }
    const addItem = async (page: Page, name: string, price: string, who: string[]) => {
      await page.getByLabel('Item name').fill(name)
      await page.getByLabel('Price').fill(price)
      for (const w of who) await page.getByRole('checkbox', { name: w }).check()
      await page.getByRole('button', { name: /^(Add|Save) item$/ }).click()
    }
    const noHScroll = async (page: Page) =>
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

    test('full walkthrough', async ({ page }) => {
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())
      await page.reload()

      // default tip is 18%, with presets in order 10, 15, 18, 20
      await expect(page.getByRole('button', { name: '18%', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByLabel('Custom tip percentage')).toHaveValue('18')
      const presets = page.getByRole('group', { name: 'Tip' }).getByRole('button')
      await expect(presets).toHaveText(['10%', '15%', '18%', '20%', 'No tip'])
      await page.screenshot({ path: `shots/${size.name}-default-tip.png`, fullPage: true })

      // 1. people
      await addPerson(page, 'Ann')
      await addPerson(page, 'Bob')
      await addPerson(page, 'Cy')
      await page.getByRole('button', { name: 'Add person' }).click()
      await expect(page.getByText('Enter a name.')).toBeVisible()
      await addPerson(page, 'ann')
      await expect(page.getByText(/already someone called/)).toBeVisible()
      await page.getByRole('button', { name: 'Rename Cy' }).click()
      await page.getByLabel('Rename Cy').fill('Cyrus')
      await page.getByRole('button', { name: 'Save' }).click()
      await expect(page.getByTestId('person-row').nth(2)).toContainText('Cyrus')
      await addPerson(page, 'Dan')
      await page.getByRole('button', { name: 'Remove Dan' }).click()
      await expect(page.getByTestId('person-row')).toHaveCount(3)

      // 9. validation
      await page.getByRole('button', { name: 'Add item' }).click()
      await expect(page.getByText('Enter an item name.')).toBeVisible()
      await expect(page.getByText('Enter a price.')).toBeVisible()
      await expect(page.getByText(/Pick at least one person/)).toBeVisible()
      await page.getByLabel('Item name').fill('Pizza')
      await page.getByLabel('Price').fill('-5')
      await page.getByRole('button', { name: 'Add item' }).click()
      await expect(page.getByText('Price cannot be negative.')).toBeVisible()
      await page.getByLabel('Price').fill('1.234')
      await page.getByRole('button', { name: 'Add item' }).click()
      await expect(page.getByText(/at most 2 decimal/)).toBeVisible()
      await page.getByLabel('Price').fill('30')
      await page.getByRole('button', { name: 'Add item' }).click()
      await expect(page.getByText(/Pick at least one person/)).toBeVisible()
      await expect(page.getByTestId('item-row')).toHaveCount(0)

      // 2. items: add, edit, remove
      await page.getByRole('checkbox', { name: 'Ann' }).check()
      await page.getByRole('checkbox', { name: 'Bob' }).check()
      await page.getByRole('button', { name: 'Add item' }).click()
      await addItem(page, 'Wine', '20', ['Cyrus'])
      await addItem(page, 'Temp', '5', ['Ann'])
      await expect(page.getByTestId('item-row')).toHaveCount(3)
      await page.getByRole('button', { name: 'Remove Temp' }).click()
      await expect(page.getByTestId('item-row')).toHaveCount(2)
      await page.getByRole('button', { name: 'Edit Wine' }).click()
      await page.getByLabel('Price').fill('25,00')
      await page.getByRole('checkbox', { name: 'Ann' }).check()
      await page.getByRole('button', { name: 'Save item' }).click()
      await expect(page.getByTestId('item-row').nth(1)).toContainText('$25.00')
      await expect(page.getByTestId('item-row').nth(1)).toContainText('Cyrus, Ann')
      await expect(page.getByTestId('item-row')).toHaveCount(2)

      // 3/4. tax and tip (default 18% applies before touching anything: 55.00 * 18% = 9.90)
      await expect(page.getByTestId('bill-tip')).toHaveText('$9.90')
      await page.getByRole('button', { name: '18%', exact: true }).click()
      await expect(page.getByTestId('bill-tip')).toHaveText('$9.90')
      await page.getByLabel('Tax (%)').fill('10')
      await page.getByRole('button', { name: '20%', exact: true }).click()
      await expect(page.getByRole('button', { name: '20%', exact: true })).toHaveAttribute('aria-pressed', 'true')
      // subtotal 55 -> tax 5.50, tip 11
      await expect(page.getByTestId('bill-subtotal')).toHaveText('$55.00')
      await expect(page.getByTestId('bill-tax')).toHaveText('$5.50')
      await expect(page.getByTestId('bill-tip')).toHaveText('$11.00')
      await expect(page.getByTestId('bill-total')).toHaveText('$71.50')
      await page.getByLabel('Custom tip percentage').fill('15')
      await expect(page.getByRole('button', { name: '15%', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await page.getByLabel('Custom tip percentage').fill('12.5')
      await expect(page.getByTestId('bill-tip')).toHaveText('$6.88')
      await page.getByLabel('Custom tip percentage').fill('-3')
      await expect(page.getByText('Tip cannot be negative.')).toBeVisible()
      await page.getByRole('button', { name: '10%', exact: true }).click()
      await page.getByLabel('Tax (%)').fill('abc')
      await expect(page.getByText(/Tax must be a number/)).toBeVisible()
      await page.getByLabel('Tax (%)').fill('10')

      // 5/6. breakdown, exact sum
      const totals = (await page.getByTestId('person-total').allTextContents()).map((t) => Number(t.replace(/[^0-9.]/g, '')))
      const bill = Number((await page.getByTestId('bill-total').textContent())!.replace(/[^0-9.]/g, ''))
      expect(Math.round(totals.reduce((a, b) => a + b * 100, 0))).toBe(Math.round(bill * 100))
      await expect(page.getByTestId('breakdown-row').first()).toContainText('Items')
      await expect(page.getByTestId('breakdown-row').first()).toContainText('Tax')
      await expect(page.getByTestId('breakdown-row').first()).toContainText('Tip')
      await noHScroll(page)
      await page.screenshot({ path: `shots/${size.name}-main.png`, fullPage: true })

      // 7. currency
      await page.getByLabel('Currency').selectOption('EUR')
      await expect(page.getByTestId('bill-total')).toContainText('€')
      await expect(page.getByTestId('bill-total')).toHaveText(/,\d\d/)
      await page.getByLabel('Currency').selectOption('PLN')
      await expect(page.getByTestId('bill-total')).toContainText('zł')

      // 8. copy
      await page.getByRole('button', { name: 'Copy summary' }).click()
      await expect(page.getByRole('status')).toContainText('copied')
      const clip = await page.evaluate(() => navigator.clipboard.readText())
      expect(clip).toContain('Bill summary')
      expect(clip).toContain('Pizza')
      expect(clip).toContain('zł')
      expect(clip).toContain('Per person:')

      // 11. reload persistence
      const before = await page.getByTestId('bill-total').textContent()
      await page.reload()
      await expect(page.getByTestId('person-row')).toHaveCount(3)
      await expect(page.getByTestId('item-row')).toHaveCount(2)
      await expect(page.getByLabel('Currency')).toHaveValue('PLN')
      await expect(page.getByLabel('Tax (%)')).toHaveValue('10')
      await expect(page.getByTestId('bill-total')).toHaveText(before!)

      // removing a person drops them from shared items; Pizza (Ann, Bob) loses Bob only
      await page.getByRole('button', { name: 'Remove Cyrus' }).click()
      await expect(page.getByTestId('item-row').nth(1)).not.toContainText('Cyrus')
      await expect(page.getByText(/nobody assigned/i)).toHaveCount(0)
      // removing the last sharer of an item warns instead of silently dropping it
      await page.getByRole('button', { name: 'Remove Ann' }).click()
      await expect(page.getByText(/nobody assigned/i)).toBeVisible()
      await page.getByRole('button', { name: 'Add person' }).click()
      await addPerson(page, 'Ann')

      // 10. reset with confirmation
      await page.getByRole('button', { name: 'Reset' }).click()
      await page.getByRole('button', { name: 'Cancel' }).last().click()
      await expect(page.getByTestId('person-row')).toHaveCount(2)
      await page.getByRole('button', { name: 'Reset' }).click()
      await page.screenshot({ path: `shots/${size.name}-reset.png`, fullPage: true })
      await page.getByRole('button', { name: 'Yes, reset' }).click()
      await expect(page.getByTestId('person-row')).toHaveCount(0)
      await expect(page.getByTestId('item-row')).toHaveCount(0)
      await expect(page.getByRole('button', { name: '18%', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await page.reload()
      await expect(page.getByTestId('person-row')).toHaveCount(0)
      await expect(page.getByLabel('Custom tip percentage')).toHaveValue('18')
      await noHScroll(page)
    })
  })
}
