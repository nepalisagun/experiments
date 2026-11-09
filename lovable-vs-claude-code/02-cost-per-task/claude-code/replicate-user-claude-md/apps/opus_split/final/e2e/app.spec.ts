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

const share = (page: Page, name: string) => page.getByTestId('share').filter({ has: page.getByTestId('share-name').getByText(name, { exact: true }) })

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('people: add, rename, remove, with validation', async ({ page }) => {
  // empty name
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Name cannot be empty.')

  await addPerson(page, 'Ann')
  await addPerson(page, 'Ben')
  await addPerson(page, 'ann')
  await expect(page.getByRole('alert')).toHaveText('There is already someone called "ann".')
  await page.getByLabel("New person's name").fill('Cat')
  await expect(page.getByRole('alert')).toHaveCount(0) // error clears on typing
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'People (3)' })).toBeVisible()

  // rename
  await page.getByRole('button', { name: 'Rename Ben' }).click()
  await page.getByLabel('New name for Ben').fill('Ann')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('alert')).toHaveText('There is already someone called "Ann".')
  await page.getByLabel('New name for Ben').fill('Benjamin')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('button', { name: 'Rename Benjamin' })).toBeVisible()
  await expect(share(page, 'Benjamin')).toBeVisible()

  // remove (no items -> no confirmation)
  await page.getByRole('button', { name: 'Remove Cat' }).click()
  await expect(page.getByRole('heading', { name: 'People (2)' })).toBeVisible()
  await expect(share(page, 'Cat')).toHaveCount(0)
  await shot(page, 'people')
  await expectNoHorizontalScroll(page)
})

test('items: add, edit, remove, validation, and breakdown with tax and tip', async ({ page }) => {
  await addPerson(page, 'Ann')
  await addPerson(page, 'Ben')
  await addPerson(page, 'Cat')

  const form = page.getByRole('form', { name: 'Add item' })
  // validation: everything missing
  await form.getByRole('button', { name: 'Add item' }).click()
  await expect(form.getByText('Give the item a name.')).toBeVisible()
  await expect(form.getByText('Enter a price.')).toBeVisible()
  await expect(form.getByText('Pick at least one person who shared this item.')).toBeVisible()
  // negative price
  await form.getByLabel('Item').fill('Bad')
  await form.getByLabel('Price').fill('-5')
  await form.getByRole('button', { name: 'Add item' }).click()
  await expect(form.getByText('Price cannot be negative.')).toBeVisible()
  await expect(page.getByTestId('item-row')).toHaveCount(0)
  await shot(page, 'item-validation')

  await addItem(page, 'Pizza', '30', ['Ann', 'Ben', 'Cat'])
  await addItem(page, 'Wine', '20.00', ['Ann'])
  await expect(page.getByTestId('item-row')).toHaveCount(2)
  await expect(form.getByLabel('Item')).toHaveValue('') // form cleared

  // "Everyone" shortcut
  await form.getByLabel('Item').fill('Bread')
  await form.getByLabel('Price').fill('4.5')
  await form.getByRole('button', { name: 'Everyone' }).click()
  await expect(form.getByRole('checkbox', { name: 'Cat' })).toBeChecked()
  await form.getByRole('button', { name: 'Add item' }).click()
  await page.getByRole('button', { name: 'Remove Bread' }).click()
  await expect(page.getByTestId('item-row')).toHaveCount(2)

  // Defaults: tax 0, tip 18%
  await expect(page.getByTestId('bill-subtotal')).toHaveText('$50.00')
  await expect(page.getByRole('button', { name: '18%' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('bill-tip')).toHaveText('$9.00')
  await expect(page.getByTestId('bill-tax')).toHaveText('$0.00')
  // presets appear in order, with 18% between 15% and 20%
  const tipGroup = page.getByRole('group', { name: 'Tip' })
  await expect(tipGroup.getByRole('button')).toHaveText(['10%', '15%', '18%', '20%', 'Custom'])
  const boxes = await Promise.all(['15%', '18%', '20%'].map((n) => tipGroup.getByRole('button', { name: n }).boundingBox()))
  // on the same row, or wrapped onto the next one in reading order
  expect(boxes[0]!.y < boxes[1]!.y || boxes[0]!.x < boxes[1]!.x).toBe(true)
  expect(boxes[1]!.y < boxes[2]!.y || boxes[1]!.x < boxes[2]!.x).toBe(true)
  await shot(page, 'tip-default-18')

  // Tax 10%, tip presets
  await page.getByLabel('Tax', { exact: true }).fill('10')
  await page.getByRole('button', { name: '20%' }).click()
  await expect(page.getByRole('button', { name: '20%' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('bill-tax')).toHaveText('$5.00')
  await expect(page.getByTestId('bill-tip')).toHaveText('$10.00')
  await expect(page.getByTestId('bill-total')).toHaveText('$65.00')
  await expect(share(page, 'Ann').getByTestId('share-subtotal')).toHaveText('$30.00')
  await expect(share(page, 'Ann').getByTestId('share-tax')).toHaveText('$3.00')
  await expect(share(page, 'Ann').getByTestId('share-tip')).toHaveText('$6.00')
  await expect(share(page, 'Ann').getByTestId('share-total')).toHaveText('$39.00')
  await expect(share(page, 'Ben').getByTestId('share-total')).toHaveText('$13.00')

  await page.getByRole('button', { name: '10%' }).click()
  await expect(page.getByTestId('bill-tip')).toHaveText('$5.00')
  await page.getByRole('button', { name: '15%' }).click()
  await expect(page.getByTestId('bill-tip')).toHaveText('$7.50')
  await page.getByRole('button', { name: '18%' }).click()
  await expect(page.getByRole('button', { name: '18%' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '15%' })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('bill-tip')).toHaveText('$9.00')
  await expect(share(page, 'Ann').getByTestId('share-tip')).toHaveText('$5.40')

  // custom tip + validation
  await page.getByRole('button', { name: 'Custom' }).click()
  await expect(page.getByLabel('Custom tip percentage')).toBeFocused()
  await page.getByLabel('Custom tip percentage').fill('-4')
  await expect(page.getByText('Tip cannot be negative. Tip is counted as 0% until fixed.')).toBeVisible()
  await page.getByLabel('Custom tip percentage').fill('18')
  await expect(page.getByTestId('bill-tip')).toHaveText('$9.00')
  await page.getByLabel('Tax', { exact: true }).fill('-1')
  await expect(page.getByText('Tax cannot be negative. Tax is counted as 0% until fixed.')).toBeVisible()
  await page.getByLabel('Tax', { exact: true }).fill('10')

  // edit an item: change price and sharers
  await page.getByRole('button', { name: 'Edit Wine' }).click()
  const edit = page.getByRole('form', { name: 'Edit item' })
  await expect(edit.getByLabel('Price')).toHaveValue('20.00')
  await edit.getByRole('checkbox', { name: 'Ann' }).uncheck()
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(edit.getByText('Pick at least one person who shared this item.')).toBeVisible()
  await edit.getByRole('checkbox', { name: 'Ben' }).check()
  await edit.getByLabel('Price').fill('12.345')
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(edit.getByText('Price can have at most 2 decimal places.')).toBeVisible()
  await edit.getByLabel('Price').fill('24')
  await edit.getByLabel('Item').fill('Red wine')
  await edit.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByTestId('item-row').filter({ hasText: 'Red wine' })).toContainText('$24.00')
  await expect(page.getByTestId('item-row').filter({ hasText: 'Red wine' })).toContainText('For Ben')
  await expect(share(page, 'Ben').getByTestId('share-subtotal')).toHaveText('$34.00')
  await shot(page, 'breakdown')
  await expectNoHorizontalScroll(page)
})

test('rounding: per-person totals add up exactly to the bill total', async ({ page }) => {
  for (const n of ['Ann', 'Ben', 'Cat']) await addPerson(page, n)
  await addItem(page, 'Dessert', '10', ['Ann', 'Ben', 'Cat'])
  await addItem(page, 'Coffee', '3.33', ['Ben', 'Cat'])
  await page.getByLabel('Tax', { exact: true }).fill('8.875')
  await page.getByRole('button', { name: 'Custom' }).click()
  await page.getByLabel('Custom tip percentage').fill('17.3')

  const toCents = (s: string) => Math.round(Number(s.replace(/[^0-9.]/g, '')) * 100)
  const totals = (await page.getByTestId('share-total').allTextContents()).map(toCents)
  const billTotal = toCents((await page.getByTestId('bill-total').textContent())!)
  expect(totals.reduce((a, b) => a + b, 0)).toBe(billTotal)
  for (const col of ['share-subtotal', 'share-tax', 'share-tip'] as const) {
    const vals = (await page.getByTestId(col).allTextContents()).map(toCents)
    const billCol = { 'share-subtotal': 'bill-subtotal', 'share-tax': 'bill-tax', 'share-tip': 'bill-tip' }[col]
    expect(vals.reduce((a, b) => a + b, 0)).toBe(toCents((await page.getByTestId(billCol).textContent())!))
  }
  // 13.33 subtotal; tax 1.183 -> 1.18; tip 2.306 -> 2.31; total 16.82
  await expect(page.getByTestId('bill-total')).toHaveText('$16.82')
})

test('currency selector changes formatting', async ({ page }) => {
  await addPerson(page, 'Ann')
  await addItem(page, 'Feast', '1234.5', ['Ann'])
  await page.getByLabel('Tax', { exact: true }).fill('0')
  await page.getByRole('button', { name: 'Custom' }).click()
  await page.getByLabel('Custom tip percentage').fill('0')
  await expect(page.getByTestId('bill-total')).toHaveText('$1,234.50')
  await page.getByLabel('Currency').selectOption('EUR')
  await expect(page.getByTestId('bill-total')).toHaveText('1.234,50 €')
  await expect(page.getByTestId('item-row')).toContainText('1.234,50 €')
  await page.getByLabel('Currency').selectOption('PLN')
  await expect(page.getByTestId('bill-total')).toHaveText('1234,50 zł')
  await shot(page, 'pln')
})

test('copy summary puts plain text on the clipboard', async ({ page }) => {
  await addPerson(page, 'Ann')
  await addPerson(page, 'Ben')
  await addItem(page, 'Pizza', '30', ['Ann', 'Ben'])
  await page.getByLabel('Tax', { exact: true }).fill('10')
  await page.getByRole('button', { name: '20%' }).click()
  await page.getByRole('button', { name: 'Copy summary' }).click()
  await expect(page.getByRole('status')).toHaveText('Summary copied to clipboard')
  // The OS clipboard on Windows hands text back with CRLF line endings.
  const text = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')
  expect(text).toBe(
    [
      'Bill summary',
      '',
      'Items:',
      '- Pizza: $30.00 (Ann, Ben)',
      '',
      'Subtotal: $30.00',
      'Tax (10%): $3.00',
      'Tip (20%): $6.00',
      'Total: $39.00',
      '',
      'Per person:',
      '- Ann: $19.50 (items $15.00, tax $1.50, tip $3.00)',
      '- Ben: $19.50 (items $15.00, tax $1.50, tip $3.00)',
    ].join('\n'),
  )
})

test('removing the only sharer of an item asks first', async ({ page }) => {
  await addPerson(page, 'Ann')
  await addPerson(page, 'Ben')
  await addItem(page, 'Wine', '20', ['Ann'])
  await addItem(page, 'Pizza', '30', ['Ann', 'Ben'])
  await page.getByRole('button', { name: 'Remove Ann' }).click()
  const dialog = page.getByRole('dialog', { name: 'Remove Ann?' })
  await expect(dialog).toContainText('Wine')
  await shot(page, 'remove-person-dialog')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('item-row')).toHaveCount(2)
  await page.getByRole('button', { name: 'Remove Ann' }).click()
  await dialog.getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByTestId('item-row')).toHaveCount(1)
  await expect(page.getByTestId('item-row')).toContainText('For Ben')
  await expect(page.getByTestId('bill-subtotal')).toHaveText('$30.00')
})

test('reset asks for confirmation', async ({ page }) => {
  await addPerson(page, 'Ann')
  await addItem(page, 'Soup', '7', ['Ann'])
  await page.getByRole('button', { name: 'Reset' }).click()
  const dialog = page.getByRole('dialog', { name: 'Reset the bill?' })
  await expect(dialog).toBeVisible()
  await shot(page, 'reset-dialog')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByTestId('item-row')).toHaveCount(1)
  // Escape also cancels
  await page.getByRole('button', { name: 'Reset' }).click()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('item-row')).toHaveCount(1)

  await page.getByRole('button', { name: 'Reset' }).click()
  await dialog.getByRole('button', { name: 'Reset' }).click()
  await expect(page.getByTestId('item-row')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'People (0)' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'People (0)' })).toBeVisible()
})

test('the bill survives a reload', async ({ page }) => {
  await addPerson(page, 'Ann')
  await addPerson(page, 'Ben')
  await addItem(page, 'Pasta', '18.40', ['Ann', 'Ben'])
  await page.getByLabel('Tax', { exact: true }).fill('7.5')
  await page.getByRole('button', { name: 'Custom' }).click()
  await page.getByLabel('Custom tip percentage').fill('12')
  await page.getByLabel('Currency').selectOption('EUR')
  const before = await page.getByTestId('bill-total').textContent()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'People (2)' })).toBeVisible()
  await expect(page.getByTestId('item-row')).toContainText('Pasta')
  await expect(page.getByLabel('Tax', { exact: true })).toHaveValue('7.5')
  await expect(page.getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Custom tip percentage')).toHaveValue('12')
  await expect(page.getByLabel('Currency')).toHaveValue('EUR')
  await expect(page.getByTestId('bill-total')).toHaveText(before!)
})

test('corrupt saved data does not break the app', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('bill-splitter:v1', '{not json'))
  await page.reload()
  await expect(page.getByRole('heading', { name: 'People (0)' })).toBeVisible()
})
