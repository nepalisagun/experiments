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
  test(`full flow @ ${size.name}`, async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      permissions: ['clipboard-read', 'clipboard-write'],
    })
    const page = await ctx.newPage()
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()

    // default tip is 18% with a preset between 15% and 20%
    await expect(page.getByRole('group', { name: 'Tip presets' }).getByRole('button')).toHaveText(['10%', '15%', '18%', '20%'])
    await expect(page.getByRole('button', { name: '18%' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('Custom %')).toHaveValue('18')
    await page.screenshot({ path: `shots/${size.name}-default.png` })

    // 1. people: add, validate, rename, remove
    await addPerson(page, 'Ann')
    await addPerson(page, 'Bob')
    await addPerson(page, 'Cy')
    await addPerson(page, 'ann')
    await expect(page.getByText('already on the list')).toBeVisible()
    await page.getByLabel('Person name').fill('')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByText('Enter a name.')).toBeVisible()
    await page.getByRole('button', { name: 'Rename Cy' }).click()
    await page.getByLabel('New name for Cy').fill('Cyrus')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByTestId('person')).toHaveCount(3)
    await expect(page.getByText('Cyrus', { exact: true }).first()).toBeVisible()
    await addPerson(page, 'Temp')
    await page.getByRole('button', { name: 'Remove Temp' }).click()
    await expect(page.getByTestId('person')).toHaveCount(3)

    // 9. validation
    await page.getByRole('button', { name: 'Add item' }).click()
    await expect(page.getByText('Enter an item name.')).toBeVisible()
    await expect(page.getByText('Enter a price.')).toBeVisible()
    await expect(page.getByText('Select at least one person')).toBeVisible()
    await page.getByLabel('Item', { exact: true }).fill('Bad')
    await page.getByLabel('Price').fill('-5')
    await page.getByRole('button', { name: 'Add item' }).click()
    await expect(page.getByText('Price cannot be negative.')).toBeVisible()
    await expect(page.getByTestId('item')).toHaveCount(0)

    // 2. items: add, edit, remove
    await page.getByLabel('Item', { exact: true }).fill('')
    await page.getByLabel('Price').fill('')
    await addItem(page, 'Pizza', '10.00', ['Ann', 'Bob', 'Cyrus'])
    await addItem(page, 'Wine', '30,00', ['Ann'])
    await addItem(page, 'Oops', '5', ['Bob'])
    await expect(page.getByTestId('item')).toHaveCount(3)
    await page.getByRole('button', { name: 'Remove item Oops' }).click()
    await expect(page.getByTestId('item')).toHaveCount(2)
    await page.getByRole('button', { name: 'Edit Wine' }).click()
    await page.getByLabel('Price').fill('20')
    await page.getByLabel('Bob', { exact: true }).check()
    await page.getByRole('button', { name: 'Save item' }).click()
    await expect(page.getByTestId('item').nth(1)).toContainText('$20.00')
    await expect(page.getByTestId('item').nth(1)).toContainText('Ann, Bob')
    // editing: item with nobody selected is rejected
    await page.getByRole('button', { name: 'Edit Wine' }).click()
    await page.getByLabel('Ann', { exact: true }).uncheck()
    await page.getByLabel('Bob', { exact: true }).uncheck()
    await page.getByRole('button', { name: 'Save item' }).click()
    await expect(page.getByText('Select at least one person')).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()

    // 3/4. tax and tip
    await page.getByLabel('Tax (%)').fill('10')
    await page.getByRole('button', { name: '20%' }).click()
    await expect(page.getByRole('button', { name: '20%' })).toHaveAttribute('aria-pressed', 'true')
    // subtotal 30: Ann 10/3 + 10 => 13.33(4),Bob 3.33+10, Cy 3.33 ; tax 3.00 tip 6.00
    await expect(page.getByTestId('grand-total')).toHaveText('$39.00')
    await page.getByRole('button', { name: '15%' }).click()
    await expect(page.getByTestId('grand-total')).toHaveText('$37.50')
    await page.getByRole('button', { name: '18%' }).click()
    await expect(page.getByRole('button', { name: '18%' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByLabel('Custom %')).toHaveValue('18')
    await expect(page.getByTestId('grand-total')).toHaveText('$38.40')
    await page.getByLabel('Custom %').fill('12.5')
    await expect(page.getByRole('button', { name: '15%' })).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('grand-total')).toHaveText('$36.75')
    await page.getByLabel('Custom %').fill('-3')
    await expect(page.getByText('Tip cannot be negative.')).toBeVisible()
    await page.getByLabel('Custom %').fill('20')

    // 5/6. breakdown sums to total
    const totals = await page.getByTestId('share-total').allTextContents()
    expect(totals).toHaveLength(3)
    const cents = totals.map((t) => Math.round(parseFloat(t.replace('$', '')) * 100))
    expect(cents.reduce((a, b) => a + b, 0)).toBe(3900)
    await expect(page.getByTestId('share').first()).toContainText('Items')
    await expect(page.getByTestId('share').first()).toContainText('Tax')
    await expect(page.getByTestId('share').first()).toContainText('Tip')

    // 7. currency
    await page.getByLabel('Currency').selectOption('EUR')
    await expect(page.getByTestId('grand-total')).toContainText('39,00')
    await expect(page.getByTestId('grand-total')).toContainText('€')
    await page.getByLabel('Currency').selectOption('PLN')
    await expect(page.getByTestId('grand-total')).toContainText('zł')

    // 8. copy
    await page.getByRole('button', { name: 'Copy summary' }).click()
    await expect(page.getByText('Copied to clipboard!')).toBeVisible()
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toContain('Bill summary')
    expect(clip).toContain('Ann:')
    expect(clip).toContain('zł')

    await noHScroll(page)
    await page.screenshot({ path: `shots/${size.name}-full.png`, fullPage: true })

    // 11. reload persistence
    await page.reload()
    await expect(page.getByTestId('person')).toHaveCount(3)
    await expect(page.getByTestId('item')).toHaveCount(2)
    await expect(page.getByLabel('Currency')).toHaveValue('PLN')
    await expect(page.getByLabel('Tax (%)')).toHaveValue('10')
    await expect(page.getByLabel('Custom %')).toHaveValue('20')

    // removing a person with items: shares update; orphaned item warns
    await page.getByRole('button', { name: 'Remove Ann' }).click()
    await expect(page.getByTestId('item').nth(1)).toContainText('Bob')
    await page.getByRole('button', { name: 'Remove Bob' }).click()
    await expect(page.getByText('not counted')).toBeVisible()
    await expect(page.getByText('Wine').first()).toBeVisible()

    // 10. reset with confirmation
    await page.getByRole('button', { name: 'Reset' }).click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByTestId('person')).toHaveCount(1)
    await page.getByRole('button', { name: 'Reset' }).click()
    await page.screenshot({ path: `shots/${size.name}-reset.png` })
    await page.getByRole('button', { name: 'Yes, reset' }).click()
    await expect(page.getByTestId('person')).toHaveCount(0)
    await expect(page.getByTestId('item')).toHaveCount(0)
    await page.reload()
    await expect(page.getByTestId('person')).toHaveCount(0)
    await expect(page.getByLabel('Currency')).toHaveValue('USD')
    await expect(page.getByLabel('Custom %')).toHaveValue('18')
    await ctx.close()
  })
}
