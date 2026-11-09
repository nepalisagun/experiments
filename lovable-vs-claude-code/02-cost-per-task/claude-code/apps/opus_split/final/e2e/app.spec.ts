import { expect, test, type Page } from '@playwright/test'

const sizes = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
]

async function addPerson(page: Page, name: string) {
  await page.getByLabel('Person name').fill(name)
  await page.getByRole('button', { name: 'Add person' }).click()
}

async function addItem(page: Page, name: string, price: string, onlyFor?: string[]) {
  await page.getByLabel('Item name').fill(name)
  await page.getByLabel(/^Price/).fill(price)
  if (onlyFor) {
    const form = page.getByRole('form', { name: /item/i })
    // start from nobody, then tick the requested people
    const toggle = form.getByRole('button', { name: /Select all|Clear all/ })
    if ((await toggle.textContent()) === 'Clear all') await toggle.click()
    for (const n of onlyFor) {
      await form.locator('label', { hasText: new RegExp(`^[✓+]${n}$`) }).click()
      await expect(form.getByRole('checkbox', { name: n, exact: true })).toBeChecked()
    }
  }
  await page.getByRole('button', { name: /^(Add|Save) item$/ }).click()
}

/** Reads the per-person totals from whichever breakdown layout is visible. */
async function personTotals(page: Page, mobile: boolean): Promise<string[]> {
  if (mobile) {
    return page.getByTestId('breakdown-cards').locator('li > div:first-child > span:last-child').allTextContents()
  }
  return page.getByTestId('breakdown-row').locator('td:last-child').allTextContents()
}

const toCents = (s: string) => Math.round(Number(s.replace(/[^\d.,-]/g, '').replace(/,/g, '')) * 100)

for (const size of sizes) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } })

    test.beforeEach(async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())
      await page.reload()
    })

    test('full walkthrough of every requirement', async ({ page }) => {
      const mobile = size.name === 'mobile'
      const shot = (n: string) => page.screenshot({ path: `shots/${size.name}-${n}.png`, fullPage: true })

      // 1. people: add, validation, rename, remove
      await page.getByRole('button', { name: 'Add person' }).click()
      await expect(page.getByText('Name cannot be empty.')).toBeVisible()
      await addPerson(page, 'Ann')
      await addPerson(page, 'Bob')
      await addPerson(page, 'Cat')
      await addPerson(page, 'ann')
      await expect(page.getByText('"ann" is already on the list.')).toBeVisible()
      await page.getByLabel('Person name').fill('')
      await addPerson(page, 'Dan')
      await expect(page.getByTestId('person-row')).toHaveCount(4)

      await page.getByRole('button', { name: 'Rename Cat' }).click()
      await page.getByLabel('New name for Cat').fill('Cathy')
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByTestId('person-row').filter({ hasText: 'Cathy' })).toBeVisible()

      await page.getByRole('button', { name: 'Remove Dan' }).click()
      await expect(page.getByTestId('person-row')).toHaveCount(3)

      // 2 + 9. items with validation
      await page.getByRole('button', { name: 'Add item' }).click()
      await expect(page.getByText('Give the item a name.')).toBeVisible()
      await expect(page.getByText('Enter a price.')).toBeVisible()

      await page.getByLabel('Item name').fill('Pizza')
      await page.getByLabel(/^Price/).fill('-5')
      await page.getByRole('button', { name: 'Clear all' }).click()
      await page.getByRole('button', { name: 'Add item' }).click()
      await expect(page.getByText('Price cannot be negative.')).toBeVisible()
      await expect(page.getByText('Pick at least one person who shared this item.')).toBeVisible()
      await shot('validation')

      await page.getByLabel(/^Price/).fill('30')
      await page.getByRole('button', { name: 'Select all' }).click()
      await page.getByRole('button', { name: 'Add item' }).click()
      await expect(page.getByTestId('item-row')).toHaveCount(1)

      await addItem(page, 'Wine', '20', ['Ann'])
      await addItem(page, 'Salad', '10', ['Bob', 'Cathy'])
      await expect(page.getByTestId('item-row')).toHaveCount(3)

      // removing a person who is the only sharer is blocked with a message
      await page.getByRole('button', { name: 'Remove Ann' }).click()
      await expect(page.getByText(/Ann is the only person on "Wine"/)).toBeVisible()

      // edit an item
      await page.getByRole('button', { name: 'Edit Salad' }).click()
      await expect(page.getByLabel('Item name')).toHaveValue('Salad')
      await page.getByLabel('Item name').fill('Caesar salad')
      await page.getByLabel(/^Price/).fill('12')
      await page.getByRole('button', { name: 'Save item' }).click()
      await expect(page.getByTestId('item-row').filter({ hasText: 'Caesar salad' })).toContainText('$12.00')

      // remove an item
      await addItem(page, 'Bread', '4')
      await expect(page.getByTestId('item-row')).toHaveCount(4)
      await page.getByRole('button', { name: 'Remove Bread' }).click()
      await expect(page.getByTestId('item-row')).toHaveCount(3)

      // subtotal = 30 + 20 + 12 = 62; default tip is 18% -> 11.16
      await expect(page.getByRole('button', { name: '18%' })).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByTestId('grand-total')).toHaveText('$73.16')

      // 3. tax, with validation
      await page.getByLabel('Tax (%)').fill('-3')
      await expect(page.getByText('Tax cannot be negative.')).toBeVisible()
      await page.getByLabel('Tax (%)').fill('10')
      await expect(page.getByText('Tax cannot be negative.')).toHaveCount(0)
      await expect(page.getByTestId('grand-total')).toHaveText('$79.36')

      // 4. tip presets + custom
      await page.getByRole('button', { name: '20%' }).click()
      await expect(page.getByRole('button', { name: '20%' })).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByTestId('grand-total')).toHaveText('$80.60')
      await page.getByRole('button', { name: '15%' }).click()
      await expect(page.getByTestId('grand-total')).toHaveText('$77.50')
      await page.getByRole('button', { name: '10%' }).click()
      await expect(page.getByTestId('grand-total')).toHaveText('$74.40')
      await page.getByRole('button', { name: '18%' }).click()
      await expect(page.getByRole('button', { name: '18%' })).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByRole('button', { name: '10%' })).toHaveAttribute('aria-pressed', 'false')
      await expect(page.getByTestId('grand-total')).toHaveText('$79.36')
      // presets render in order 10, 15, 18, 20
      await expect(page.getByRole('group', { name: 'Tip (%)' }).getByRole('button')).toHaveText(['10%', '15%', '18%', '20%'])
      await page.getByRole('button', { name: '10%' }).click()
      await page.getByLabel('Custom tip percentage').fill('18.5')
      await expect(page.getByRole('button', { name: '10%' })).toHaveAttribute('aria-pressed', 'false')
      // 62 * 18.5% = 11.47 -> total 62 + 6.20 + 11.47 = 79.67
      await expect(page.getByTestId('grand-total')).toHaveText('$79.67')

      // 5 + 6. per-person breakdown that sums exactly to the bill total
      // Ann: 10 + 20 = 30, Bob: 10 + 6 = 16, Cathy: 16
      const totals = await personTotals(page, mobile)
      expect(totals).toHaveLength(3)
      const sum = totals.map(toCents).reduce((a, b) => a + b, 0)
      expect(sum).toBe(7967)
      expect(totals[0]).toBe('$38.55') // 30 + 3.00 + 5.55
      if (!mobile) {
        const annRow = page.getByTestId('breakdown-row').first().locator('td')
        await expect(annRow).toHaveText(['Ann', '$30.00', '$3.00', '$5.55', '$38.55'])
      }
      await shot('breakdown-usd')

      // awkward rounding: 3 people split 10.00
      await addItem(page, 'Water', '10')
      await page.getByLabel('Tax (%)').fill('8.875')
      const t2 = await personTotals(page, mobile)
      const grand = toCents((await page.getByTestId('grand-total').textContent())!)
      expect(t2.map(toCents).reduce((a, b) => a + b, 0)).toBe(grand)

      // 7. currency formatting
      await page.getByLabel('Currency').selectOption('EUR')
      await expect(page.getByTestId('grand-total')).toContainText('€')
      await expect(page.getByTestId('grand-total')).toHaveText(/^\d+,\d{2} €$/)
      await page.getByLabel('Currency').selectOption('PLN')
      await expect(page.getByTestId('grand-total')).toHaveText(/^\d+,\d{2} zł$/)
      await expect(page.getByLabel(/^Price/)).toBeVisible()
      await expect(page.getByText('Price (PLN)')).toBeVisible()
      await shot('breakdown-pln')

      // 8. copy summary
      await page.getByRole('button', { name: 'Copy summary' }).click()
      await expect(page.getByText('Summary copied to clipboard.')).toBeVisible()
      const clip = await page.evaluate(() => navigator.clipboard.readText())
      expect(clip).toContain('Bill summary')
      expect(clip).toContain('Pizza — 30,00 zł (Ann, Bob, Cathy)')
      expect(clip).toContain('Tax (8.875%)')
      expect(clip).toContain('Tip (18.5%)')
      expect(clip).toMatch(/Ann: [\d ]+,\d{2} zł \(items/)

      // 11. survives reload
      await page.reload()
      await expect(page.getByTestId('item-row')).toHaveCount(4)
      await expect(page.getByTestId('person-row')).toHaveCount(3)
      await expect(page.getByLabel('Currency')).toHaveValue('PLN')
      await expect(page.getByLabel('Tax (%)')).toHaveValue('8.875')
      await expect(page.getByLabel('Custom tip percentage')).toHaveValue('18.5')
      expect(toCents((await page.getByTestId('grand-total').textContent())!.replace(',', '.'))).toBe(
        toCents(String(grand / 100)),
      )

      // 10. reset with confirmation: cancel keeps data, confirm clears
      await page.getByRole('button', { name: 'Reset' }).click()
      await expect(page.getByRole('alertdialog')).toBeVisible()
      await shot('reset-confirm')
      await page.getByRole('button', { name: 'Cancel' }).click()
      await expect(page.getByTestId('item-row')).toHaveCount(4)
      await page.getByRole('button', { name: 'Reset' }).click()
      await page.getByRole('button', { name: 'Yes, reset' }).click()
      await expect(page.getByTestId('item-row')).toHaveCount(0)
      await expect(page.getByTestId('person-row')).toHaveCount(0)
      await expect(page.getByLabel('Tax (%)')).toHaveValue('')
      await expect(page.getByRole('button', { name: '18%' })).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByLabel('Custom tip percentage')).toHaveValue('')
      await shot('after-reset')
      await page.reload()
      await expect(page.getByRole('button', { name: '18%' })).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByTestId('person-row')).toHaveCount(0)

      // no horizontal overflow at this width
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow).toBeLessThanOrEqual(0)
    })

    test('layout has no horizontal scroll with a full bill', async ({ page }) => {
      for (const n of ['Alexandra', 'Bartholomew', 'Christopher', 'Dominika']) await addPerson(page, n)
      await addItem(page, 'Seafood platter for the whole table', '1234.56')
      await addItem(page, 'Espresso', '3.10', ['Dominika'])
      await page.getByLabel('Tax (%)').fill('23')
      await page.getByRole('button', { name: '15%' }).click()
      await page.getByLabel('Currency').selectOption('PLN')
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow).toBeLessThanOrEqual(0)
      await page.screenshot({ path: `shots/${size.name}-full.png`, fullPage: true })
    })
  })
}
