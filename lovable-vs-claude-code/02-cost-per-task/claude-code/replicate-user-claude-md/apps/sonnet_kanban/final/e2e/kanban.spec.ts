import { expect, test, type Locator, type Page } from '@playwright/test'

const sizes = [
  { name: 'desktop', width: 1280, height: 800, touch: false },
  { name: 'mobile', width: 375, height: 800, touch: true },
]

const ymd = (offsetDays: number) => {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const col = (page: Page, id: 'todo' | 'doing' | 'done') => page.getByTestId(`column-${id}`)
// Match by exact title (hasText is a case-insensitive substring match and also sees button labels).
const cardIn = (c: Locator, title: string) =>
  c.getByTestId('card').filter({ has: c.page().getByTestId('card-title').getByText(title, { exact: true }) })

async function addCard(
  page: Page,
  column: 'todo' | 'doing' | 'done',
  c: { title: string; description?: string; due?: string; priority?: string },
) {
  await col(page, column).getByRole('button', { name: /^Add card to/ }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByLabel('Title').fill(c.title)
  if (c.description) await dlg.getByLabel(/Description/).fill(c.description)
  if (c.due) await dlg.getByLabel(/Due date/).fill(c.due)
  if (c.priority) await dlg.getByLabel('Priority').selectOption({ label: c.priority })
  await dlg.getByRole('button', { name: 'Add card' }).click()
  await expect(dlg).toBeHidden()
}

async function mouseDrag(page: Page, from: Locator, to: Locator, toPos?: { x: number; y: number }) {
  await from.scrollIntoViewIfNeeded()
  await page.waitForTimeout(400) // let the previous drop animation settle before measuring
  const a = (await from.boundingBox())!
  const b = (await to.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + 12)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + 20, { steps: 3 })
  await page.mouse.move(toPos?.x ?? b.x + b.width / 2, toPos?.y ?? b.y + b.height / 2, { steps: 15 })
  await page.mouse.up()
}

async function touchDrag(page: Page, from: Locator, to: Locator) {
  await from.scrollIntoViewIfNeeded()
  const a = (await from.boundingBox())!
  const cdp = await page.context().newCDPSession(page)
  const sx = a.x + a.width / 2
  const sy = a.y + 12
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] })
  await page.waitForTimeout(350) // long-press to pick up
  const b = (await to.boundingBox())!
  const tx = b.x + b.width / 2
  const ty = b.y + b.height / 2
  for (let i = 1; i <= 15; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: sx + ((tx - sx) * i) / 15, y: sy + ((ty - sy) * i) / 15 }],
    })
    await page.waitForTimeout(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
}

for (const size of sizes) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch })

    test.beforeEach(async ({ page }) => {
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())
      await page.reload()
    })

    test('layout: three columns, no horizontal overflow, empty states', async ({ page }) => {
      for (const [id, name] of [['todo', 'To do'], ['doing', 'In progress'], ['done', 'Done']] as const) {
        await expect(col(page, id).getByRole('heading', { name, exact: true })).toBeVisible()
        await expect(col(page, id).getByTestId('empty')).toBeVisible()
        await expect(col(page, id).getByTestId('count')).toContainText('0')
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)
      const xs = await Promise.all((['todo', 'doing', 'done'] as const).map(async (c) => (await col(page, c).boundingBox())!))
      if (size.width >= 1000) expect(new Set(xs.map((b) => Math.round(b.y))).size).toBe(1) // side by side
      else expect(xs[1].y).toBeGreaterThan(xs[0].y) // stacked
      await page.screenshot({ path: `shots/${size.name}-empty.png`, fullPage: true })
    })

    test('add card: validation, fields, priority label, count, cancel, escape', async ({ page }) => {
      await page.getByRole('button', { name: 'New card' }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Add card' }).click()
      await expect(page.getByText('Title is required.')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toBeHidden()
      await expect(page.getByTestId('card')).toHaveCount(0)

      await addCard(page, 'todo', { title: 'Write spec', description: 'Cover edge cases', due: ymd(5), priority: 'High' })
      await addCard(page, 'todo', { title: 'Minimal' }) // optional fields omitted
      const card = cardIn(col(page, 'todo'), 'Write spec')
      await expect(card).toContainText('Cover edge cases')
      await expect(card).toContainText('Due ')
      await expect(card.getByTestId('priority-label')).toHaveText('High')
      await expect(cardIn(col(page, 'todo'), 'Minimal').getByTestId('priority-label')).toHaveText('Medium')
      await expect(cardIn(col(page, 'todo'), 'Minimal').getByTestId('due')).toHaveCount(0)
      await expect(col(page, 'todo').getByTestId('count')).toHaveText('2')
      await expect(col(page, 'todo').getByTestId('empty')).toHaveCount(0)
      await page.screenshot({ path: `shots/${size.name}-cards.png`, fullPage: true })
    })

    test('priority colours differ', async ({ page }) => {
      for (const p of ['Low', 'Medium', 'High']) await addCard(page, 'todo', { title: `P-${p}`, priority: p })
      const colors = new Set<string>()
      for (const p of ['Low', 'Medium', 'High'])
        colors.add(await cardIn(col(page, 'todo'), `P-${p}`).getByTestId('priority-label').evaluate((e) => getComputedStyle(e).backgroundColor))
      expect(colors.size).toBe(3)
    })

    test('edit card', async ({ page }) => {
      await addCard(page, 'todo', { title: 'Old', priority: 'Low' })
      await page.getByRole('button', { name: 'Edit "Old"' }).click()
      const dlg = page.getByRole('dialog')
      await expect(dlg.getByLabel('Title')).toHaveValue('Old')
      await dlg.getByLabel('Title').fill('New title')
      await dlg.getByLabel(/Description/).fill('added desc')
      await dlg.getByLabel('Priority').selectOption({ label: 'High' })
      await dlg.getByRole('button', { name: 'Save' }).click()
      const card = cardIn(col(page, 'todo'), 'New title')
      await expect(card).toContainText('added desc')
      await expect(card.getByTestId('priority-label')).toHaveText('High')
      await expect(page.getByText('Old', { exact: true })).toHaveCount(0)
      await expect(col(page, 'todo').getByTestId('count')).toHaveText('1')
    })

    test('delete asks for confirmation; cancel keeps, confirm removes', async ({ page }) => {
      await addCard(page, 'todo', { title: 'Doomed' })
      await page.getByRole('button', { name: 'Delete "Doomed"' }).click()
      const dlg = page.getByRole('alertdialog').or(page.getByRole('dialog'))
      await expect(dlg).toContainText('Delete this card?')
      await dlg.getByRole('button', { name: 'Cancel' }).click()
      await expect(page.getByTestId('card')).toHaveCount(1)
      await page.getByRole('button', { name: 'Delete "Doomed"' }).click()
      await dlg.getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(page.getByTestId('card')).toHaveCount(0)
      await expect(col(page, 'todo').getByTestId('empty')).toBeVisible()
    })

    test('keyboard: move buttons and Alt+arrows change column / order, focus stays', async ({ page }) => {
      await addCard(page, 'todo', { title: 'K1' })
      await addCard(page, 'todo', { title: 'K2' })
      await page.getByRole('button', { name: 'Move "K1" to In progress' }).click()
      await expect(cardIn(col(page, 'doing'), 'K1')).toBeVisible()
      await expect(col(page, 'todo').getByTestId('count')).toHaveText('1')

      // Pure keyboard: Tab to K2 card and use Alt+Right twice
      const k2 = cardIn(col(page, 'todo'), 'K2')
      await k2.focus()
      await page.keyboard.press('Alt+ArrowRight')
      await expect(cardIn(col(page, 'doing'), 'K2')).toBeFocused()
      await page.keyboard.press('Alt+ArrowRight')
      await expect(cardIn(col(page, 'done'), 'K2')).toBeFocused()
      await page.keyboard.press('Alt+ArrowRight') // edge: no-op
      await expect(cardIn(col(page, 'done'), 'K2')).toBeVisible()
      await page.keyboard.press('Alt+ArrowLeft')
      await expect(cardIn(col(page, 'doing'), 'K2')).toBeVisible()

      // reorder in column: doing = [K1, K2] -> Alt+Up on K2
      await page.keyboard.press('Alt+ArrowUp')
      await expect(col(page, 'doing').getByTestId('card').first()).toContainText('K2')
      await page.keyboard.press('Alt+ArrowDown')
      await expect(col(page, 'doing').getByTestId('card').first()).toContainText('K1')
      // edge buttons: To do column has no left button
      await addCard(page, 'todo', { title: 'K3' })
      await expect(page.getByRole('button', { name: /Move "K3" to (?!In progress|another board)/ })).toHaveCount(0)
    })

    test('mouse drag: between columns and reorder within a column', async ({ page }) => {
      test.skip(size.touch, 'mouse covered on desktop; touch covered below')
      await addCard(page, 'todo', { title: 'A' })
      await addCard(page, 'todo', { title: 'B' })
      await addCard(page, 'todo', { title: 'C' })
      // to empty column
      await mouseDrag(page, cardIn(col(page, 'todo'), 'A'), col(page, 'doing'))
      await expect(cardIn(col(page, 'doing'), 'A')).toBeVisible()
      // onto a card in another column -> placed before it
      await mouseDrag(page, cardIn(col(page, 'todo'), 'B'), cardIn(col(page, 'doing'), 'A'))
      await expect(col(page, 'doing').getByTestId('card')).toHaveText([/B/, /A/])
      // reorder inside column: drag B below A
      await page.waitForTimeout(400)
      const a = (await cardIn(col(page, 'doing'), 'A').boundingBox())!
      await mouseDrag(page, cardIn(col(page, 'doing'), 'B'), cardIn(col(page, 'doing'), 'A'), { x: a.x + a.width / 2, y: a.y + a.height - 4 })
      await expect(col(page, 'doing').getByTestId('card')).toHaveText([/A/, /B/])
      // to Done
      await mouseDrag(page, cardIn(col(page, 'doing'), 'A'), col(page, 'done'))
      await expect(cardIn(col(page, 'done'), 'A')).toBeVisible()
      await expect(col(page, 'doing').getByTestId('count')).toContainText('1')
    })

    test('touch drag between columns (long-press, then move)', async ({ page }) => {
      test.skip(!size.touch, 'touch only on the mobile profile')
      await addCard(page, 'todo', { title: 'T1' })
      await touchDrag(page, cardIn(col(page, 'todo'), 'T1'), col(page, 'doing'))
      await expect(cardIn(col(page, 'doing'), 'T1')).toBeVisible()
      await expect(col(page, 'todo').getByTestId('empty')).toBeVisible()
    })

    test('WIP limit: warning appears above 3 and goes away at 3', async ({ page }) => {
      for (const t of ['W1', 'W2', 'W3']) await addCard(page, 'doing', { title: t })
      await expect(page.getByTestId('wip-warning')).toHaveCount(0)
      await expect(col(page, 'doing').getByTestId('count')).toHaveText('3 / 3')
      await addCard(page, 'doing', { title: 'W4' })
      await expect(page.getByTestId('wip-warning')).toBeVisible()
      await expect(page.getByTestId('wip-warning')).toContainText('limit')
      await expect(col(page, 'doing').getByTestId('count')).toHaveText('4 / 3')
      await page.screenshot({ path: `shots/${size.name}-wip.png`, fullPage: true })
      await page.getByRole('button', { name: 'Delete "W4"' }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(page.getByTestId('wip-warning')).toHaveCount(0)
      // moving into Doing via keyboard also triggers it
      await addCard(page, 'todo', { title: 'W5' })
      await page.getByRole('button', { name: 'Move "W5" to In progress' }).click()
      await expect(page.getByTestId('wip-warning')).toBeVisible()
    })

    test('search by title/description, priority filter, combined, empty results, clear', async ({ page }) => {
      await addCard(page, 'todo', { title: 'Buy milk', description: 'from the shop', priority: 'Low' })
      await addCard(page, 'doing', { title: 'Write report', priority: 'High' })
      await addCard(page, 'done', { title: 'Call plumber', description: 'about the SHOP sink', priority: 'High' })
      const search = page.getByLabel('Search cards')
      await search.fill('milk')
      await expect(page.getByTestId('card')).toHaveCount(1)
      await expect(col(page, 'todo').getByTestId('count')).toHaveText('1 of 1')
      await search.fill('shop') // description match, case-insensitive, across columns
      await expect(page.getByTestId('card')).toHaveCount(2)
      await page.getByLabel('Filter by priority').selectOption({ label: 'High' })
      await expect(page.getByTestId('card')).toHaveCount(1)
      await expect(page.getByTestId('card')).toContainText('Call plumber')
      await search.fill('zzz')
      await expect(page.getByTestId('no-results')).toBeVisible()
      await expect(col(page, 'todo').getByTestId('empty')).toContainText('No cards match')
      await page.screenshot({ path: `shots/${size.name}-noresults.png`, fullPage: true })
      await page.getByRole('button', { name: 'Clear search and filter' }).click()
      await expect(page.getByTestId('card')).toHaveCount(3)
      await expect(page.getByTestId('no-results')).toHaveCount(0)
      // priority filter alone
      await page.getByLabel('Filter by priority').selectOption({ label: 'Low' })
      await expect(page.getByTestId('card')).toHaveCount(1)
    })

    test('overdue highlight: past due not done only', async ({ page }) => {
      await addCard(page, 'todo', { title: 'Late', due: ymd(-2) })
      await addCard(page, 'doing', { title: 'LateDoing', due: ymd(-1) })
      await addCard(page, 'done', { title: 'LateDone', due: ymd(-3) })
      await addCard(page, 'todo', { title: 'Today', due: ymd(0) })
      await addCard(page, 'todo', { title: 'Future', due: ymd(4) })
      const od = (t: string) => page.getByTestId('card').filter({ hasText: t })
      await expect(od('Late').first()).toHaveAttribute('data-overdue', 'true')
      await expect(od('LateDoing')).toHaveAttribute('data-overdue', 'true')
      await expect(od('LateDone')).toHaveAttribute('data-overdue', 'false')
      await expect(od('Today')).toHaveAttribute('data-overdue', 'false')
      await expect(od('Future')).toHaveAttribute('data-overdue', 'false')
      await expect(od('Late').first()).toContainText('Overdue')
      // moving an overdue card to Done clears the highlight
      await page.getByRole('button', { name: 'Move "LateDoing" to Done' }).click()
      await expect(od('LateDoing')).toHaveAttribute('data-overdue', 'false')
      await page.screenshot({ path: `shots/${size.name}-overdue.png`, fullPage: true })
    })

    test('persistence across reload (columns, order, fields)', async ({ page }) => {
      await addCard(page, 'todo', { title: 'P1', description: 'keep me', due: ymd(3), priority: 'High' })
      await addCard(page, 'todo', { title: 'P2' })
      await addCard(page, 'doing', { title: 'P3' })
      await page.getByRole('button', { name: 'Move "P3" to Done' }).click()
      await cardIn(col(page, 'todo'), 'P2').focus()
      await page.keyboard.press('Alt+ArrowUp')
      await page.reload()
      await expect(col(page, 'todo').getByTestId('card')).toHaveText([/P2/, /P1/])
      await expect(cardIn(col(page, 'todo'), 'P1')).toContainText('keep me')
      await expect(cardIn(col(page, 'todo'), 'P1').getByTestId('priority-label')).toHaveText('High')
      await expect(cardIn(col(page, 'done'), 'P3')).toBeVisible()
      // delete persists too
      await page.getByRole('button', { name: 'Delete "P3"' }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
      await page.reload()
      await expect(page.getByTestId('card')).toHaveCount(2)
    })

    test('Done titles are struck through; other columns are not, and it follows the card', async ({ page }) => {
      const strike = (c: Locator, t: string) =>
        cardIn(c, t).getByTestId('card-title').evaluate((e) => getComputedStyle(e).textDecorationLine)
      await addCard(page, 'todo', { title: 'S1' })
      await addCard(page, 'done', { title: 'S2' })
      expect(await strike(col(page, 'todo'), 'S1')).toBe('none')
      expect(await strike(col(page, 'done'), 'S2')).toBe('line-through')
      await page.getByRole('button', { name: 'Move "S1" to In progress' }).click()
      expect(await strike(col(page, 'doing'), 'S1')).toBe('none')
      await page.getByRole('button', { name: 'Move "S1" to Done' }).click()
      expect(await strike(col(page, 'done'), 'S1')).toBe('line-through')
      await page.getByRole('button', { name: 'Move "S2" to In progress' }).click()
      expect(await strike(col(page, 'doing'), 'S2')).toBe('none')
      await page.reload() // persists
      expect(await strike(col(page, 'done'), 'S1')).toBe('line-through')
      await page.screenshot({ path: `shots/${size.name}-strike.png`, fullPage: true })
    })

    test('"Doing" label is gone everywhere', async ({ page }) => {
      for (const t of ['W1', 'W2', 'W3', 'W4']) await addCard(page, 'doing', { title: t })
      await expect(page.getByTestId('wip-warning')).toContainText('In progress')
      await expect(page.locator('body')).not.toContainText(/\bDoing\b/)
      await expect(page.getByRole('button', { name: 'Add card to In progress' })).toBeVisible()
    })

    test('corrupt localStorage does not crash the app', async ({ page }) => {
      await page.evaluate(() => localStorage.setItem('kanban.board.v1', '{broken'))
      await page.reload()
      await expect(col(page, 'todo').getByTestId('empty')).toBeVisible()
    })
  })
}
