import { expect, test, type Locator, type Page } from '@playwright/test'

const sizes = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 375, height: 700 },
]

// Tests refer to the middle column by its internal id "Doing"; its visible name is "In progress".
const label = (name: string) => (name === 'Doing' ? 'In progress' : name)
const col = (page: Page, name: string) => page.locator(`section[aria-label="${label(name)}"]`)
const cardIn = (page: Page, c: string, title: string) => col(page, c).locator('article', { hasText: title })

/** Open a card's ⋯ menu and choose an item. */
async function menuAction(card: Locator, item: string) {
  await card.getByRole('button', { name: /^Menu for/ }).click()
  await card.getByRole('menuitem', { name: item }).click()
}

async function add(page: Page, column: string, title: string, o: { desc?: string; due?: string; prio?: string } = {}) {
  await page.getByRole('button', { name: `Add card to ${label(column)}` }).click()
  const d = page.getByRole('dialog')
  await d.getByLabel('Title').fill(title)
  if (o.desc) await d.getByLabel(/Description/).fill(o.desc)
  if (o.due) await d.getByLabel(/Due date/).fill(o.due)
  if (o.prio) await d.getByLabel('Priority').selectOption({ label: o.prio })
  await d.getByRole('button', { name: 'Add card' }).click()
  await expect(d).toBeHidden()
}

/** Drag with real pointer events; holds near the viewport edge to auto-scroll until the target column is on screen. */
async function dragTo(page: Page, from: ReturnType<Page['locator']>, targetCol: string, useHandle: boolean, atStart = false) {
  const src = useHandle ? from.locator('[data-handle]') : from
  await src.scrollIntoViewIfNeeded()
  const b = (await src.boundingBox())!
  const vh = page.viewportSize()!.height
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2 + 10, b.y + b.height / 2 + 10, { steps: 3 })
  const section = col(page, targetCol)
  for (let i = 0; i < 80; i++) {
    const r = (await section.boundingBox())!
    if (r.y >= 0 && r.y + 80 < vh) break
    await page.mouse.move(b.x + b.width / 2, r.y > 0 ? vh - 20 : 20, { steps: 2 })
    await page.waitForTimeout(40)
  }
  await page.mouse.move(b.x + b.width / 2, vh / 2) // leave the edge zone so auto-scroll stops
  await page.waitForTimeout(100)
  const r = (await section.boundingBox())!
  const first = section.locator('article').first()
  const y = atStart && (await first.count()) ? (await first.boundingBox())!.y + 4 : r.y + 60
  await page.mouse.move(r.x + r.width / 2, y, { steps: 8 })
  await page.mouse.up()
}

for (const size of sizes) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: size.name === 'mobile' })

    test.beforeEach(async ({ page }) => {
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())
      await page.reload()
    })

    test('empty states, add, edit, delete with confirmation, persistence', async ({ page }) => {
      await expect(page.getByTestId('empty-todo')).toBeVisible()
      await expect(page.getByTestId('empty-doing')).toBeVisible()
      await expect(page.getByTestId('empty-done')).toBeVisible()

      await add(page, 'To do', 'Write report', { desc: 'quarterly numbers', due: '2999-01-01', prio: 'High' })
      await expect(page.getByTestId('empty-todo')).toBeHidden()
      const card = cardIn(page, 'To do', 'Write report')
      await expect(card.getByTestId('priority')).toHaveText('High')
      await expect(card).toContainText('quarterly numbers')
      await expect(card).toContainText('2999-01-01')
      await expect(page.getByTestId('count-todo')).toHaveText('1')

      // empty title rejected
      await page.getByRole('button', { name: 'Add card to Done' }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Add card' }).click()
      await expect(page.getByRole('alert')).toHaveText('Title is required')
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toBeHidden()

      // edit
      await menuAction(card, 'Edit')
      await page.getByLabel('Title').fill('Write final report')
      await page.getByRole('dialog').getByLabel('Priority').selectOption({ label: 'Low' })
      await page.getByRole('button', { name: 'Save' }).click()
      const edited = cardIn(page, 'To do', 'Write final report')
      await expect(edited.getByTestId('priority')).toHaveText('Low')

      // reload persists
      await page.reload()
      await expect(cardIn(page, 'To do', 'Write final report')).toBeVisible()

      // delete: cancel keeps, confirm removes
      await menuAction(cardIn(page, 'To do', 'Write final report'), 'Delete')
      await expect(page.getByRole('dialog')).toContainText('permanently deleted')
      await page.getByRole('button', { name: 'Cancel' }).click()
      await expect(cardIn(page, 'To do', 'Write final report')).toBeVisible()
      await menuAction(cardIn(page, 'To do', 'Write final report'), 'Delete')
      await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
      await expect(page.getByTestId('empty-todo')).toBeVisible()
      await page.reload()
      await expect(page.getByTestId('empty-todo')).toBeVisible()
    })

    test('keyboard and button moves, persisted position', async ({ page }) => {
      await add(page, 'To do', 'One')
      await add(page, 'To do', 'Two')
      const one = cardIn(page, 'To do', 'One')
      await one.focus()
      await page.keyboard.press('Alt+ArrowRight')
      await expect(cardIn(page, 'Doing', 'One')).toBeFocused()
      await page.keyboard.press('Alt+ArrowRight')
      await expect(cardIn(page, 'Done', 'One')).toBeFocused()
      await page.keyboard.press('Alt+ArrowLeft')
      await expect(cardIn(page, 'Doing', 'One')).toBeVisible()
      // button alternative
      await cardIn(page, 'To do', 'Two').getByRole('button', { name: /Move .* to In progress/ }).click()
      await expect(col(page, 'Doing').locator('article')).toHaveCount(2)
      // reorder within column
      await cardIn(page, 'Doing', 'Two').focus()
      await page.keyboard.press('Alt+ArrowUp')
      await expect(col(page, 'Doing').locator('article').first()).toContainText('Two')
      await page.reload()
      await expect(col(page, 'Doing').locator('article').first()).toContainText('Two')
    })

    test('WIP limit warning and counts', async ({ page }) => {
      for (const t of ['a', 'b', 'c']) await add(page, 'Doing', t)
      await expect(page.getByTestId('wip-warning')).toBeHidden()
      await expect(page.getByTestId('count-doing')).toHaveText('3 / 3')
      await add(page, 'Doing', 'd')
      await expect(page.getByTestId('wip-warning')).toBeVisible()
      await expect(page.getByTestId('count-doing')).toHaveText('4 / 3')
      await page.getByRole('button', { name: 'Move “d” to Done' }).click()
      await expect(page.getByTestId('wip-warning')).toBeHidden()
      await expect(page.getByTestId('count-done')).toHaveText('1')
    })

    test('search, priority filter, no results', async ({ page }) => {
      await add(page, 'To do', 'Buy milk', { prio: 'Low' })
      await add(page, 'Doing', 'Fix bug', { desc: 'milk spill in parser', prio: 'High' })
      await add(page, 'Done', 'Ship', { prio: 'High' })

      await page.getByLabel('Search cards').fill('MILK')
      await expect(page.locator('article')).toHaveCount(2)
      await page.getByLabel('Filter by priority').selectOption('high')
      await expect(page.locator('article')).toHaveCount(1)
      await expect(page.locator('article')).toContainText('Fix bug')
      await expect(page.getByTestId('count-doing')).toContainText('1 of 1')

      await page.getByLabel('Search cards').fill('zzz')
      await expect(page.getByTestId('no-results')).toBeVisible()
      await page.getByTestId('no-results').getByRole('button', { name: 'Clear filters' }).click()
      await expect(page.locator('article')).toHaveCount(3)
      await expect(page.getByTestId('no-results')).toBeHidden()

      await page.getByLabel('Filter by priority').selectOption('high')
      await expect(page.locator('article')).toHaveCount(2)
    })

    test('column is named "In progress" and Done titles are struck through', async ({ page }) => {
      await expect(page.getByRole('heading', { name: /^In progress/ })).toBeVisible()
      await expect(page.getByRole('heading', { name: /^Doing/ })).toHaveCount(0)
      await add(page, 'To do', 'Strike me')
      const deco = (c: string) => cardIn(page, c, 'Strike me').getByTestId('card-title')
        .evaluate((el) => getComputedStyle(el).textDecorationLine)
      expect(await deco('To do')).toBe('none')
      await page.getByRole('button', { name: 'Move “Strike me” to In progress' }).click()
      expect(await deco('Doing')).toBe('none')
      await page.getByRole('button', { name: 'Move “Strike me” to Done' }).click()
      expect(await deco('Done')).toBe('line-through')
      await page.screenshot({ path: `shots/${size.name}-done-strike.png`, fullPage: true })
      await page.reload() // persisted data written under the old name still maps to the column
      expect(await deco('Done')).toBe('line-through')
      await page.getByRole('button', { name: 'Move “Strike me” to In progress' }).click()
      expect(await deco('Doing')).toBe('none')
    })

    test('overdue highlight (not in Done)', async ({ page }) => {
      await add(page, 'To do', 'Late', { due: '2000-01-01' })
      await add(page, 'To do', 'Fine', { due: '2999-01-01' })
      await expect(cardIn(page, 'To do', 'Late').getByTestId('overdue-badge')).toBeVisible()
      await expect(cardIn(page, 'To do', 'Fine').getByTestId('overdue-badge')).toBeHidden()
      await cardIn(page, 'To do', 'Late').getByRole('button', { name: /Move .* to In progress/ }).click()
      await expect(cardIn(page, 'Doing', 'Late').getByTestId('overdue-badge')).toBeVisible()
      await cardIn(page, 'Doing', 'Late').getByRole('button', { name: /Move .* to Done/ }).click()
      await expect(cardIn(page, 'Done', 'Late').getByTestId('overdue-badge')).toBeHidden()
      await page.screenshot({ path: `shots/${size.name}-overdue.png`, fullPage: true })
    })

    test('pointer drag: across columns and reorder', async ({ page }) => {
      await add(page, 'To do', 'First')
      await add(page, 'To do', 'Second')
      await add(page, 'To do', 'Third')
      const handle = size.name === 'mobile'

      // reorder: drag Third above First
      await dragTo(page, cardIn(page, 'To do', 'Third'), 'To do', handle, true)
      await expect(col(page, 'To do').locator('article').first()).toContainText('Third')
      await expect(col(page, 'To do').locator('article')).toHaveCount(3)

      // cross column: drag Second into empty Doing
      await dragTo(page, cardIn(page, 'To do', 'Second'), 'Doing', handle)
      await expect(cardIn(page, 'Doing', 'Second')).toBeVisible()
      await expect(page.getByTestId('count-todo')).toHaveText('2')

      // Doing -> Done (auto-scrolls on mobile)
      await dragTo(page, cardIn(page, 'Doing', 'Second'), 'Done', handle)
      await expect(cardIn(page, 'Done', 'Second')).toBeVisible()

      // and back to the top of To do
      await dragTo(page, cardIn(page, 'Done', 'Second'), 'To do', handle, true)
      await expect(col(page, 'To do').locator('article').first()).toContainText('Second')
      const where = await page.evaluate(() => JSON.parse(localStorage.getItem('kanban-workspace-v2')!).boards[0].board.columns)
      expect(where.todo).toHaveLength(3)
      await page.screenshot({ path: `shots/${size.name}-after-drag.png`, fullPage: true })
    })

    test('touch drag via grip using touch events', async ({ page, browserName }) => {
      test.skip(size.name !== 'mobile' || browserName !== 'chromium')
      await add(page, 'To do', 'Touchy')
      const cdp = await page.context().newCDPSession(page)
      const h = (await cardIn(page, 'To do', 'Touchy').locator('[data-handle]').boundingBox())!
      const d = (await col(page, 'Doing').boundingBox())!
      const sx = h.x + h.width / 2, sy = h.y + h.height / 2
      const ty = d.y + 40
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] })
      for (let i = 1; i <= 10; i++) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: sx, y: sy + ((ty - sy) * i) / 10 }],
        })
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect(cardIn(page, 'Doing', 'Touchy')).toBeVisible()
    })

    test('layout has no horizontal overflow and looks right', async ({ page }) => {
      await add(page, 'To do', 'A somewhat long card title to test wrapping behaviour', { desc: 'desc', due: '2000-01-01', prio: 'High' })
      for (const t of ['a', 'b', 'c', 'd']) await add(page, 'Doing', t, { prio: 'Low' })
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
      expect(overflow).toBe(false)
      await page.screenshot({ path: `shots/${size.name}-board.png`, fullPage: true })
    })
  })
}
