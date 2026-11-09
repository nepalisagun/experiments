import { expect, type Locator, type Page, test } from '@playwright/test'

type Seed = { id: string; title: string; column: 'todo' | 'doing' | 'done'; priority?: string; due?: string; description?: string }

function isoOffset(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Seeds data in the *old* single-board format (key `kanban-board-v1`), so every test
 * that uses it also exercises the migration to multiple boards.
 */
async function seed(page: Page, cards: Seed[]) {
  await page.goto('/')
  await page.evaluate((cards) => {
    localStorage.clear() // drop the v2 workspace the app saved on load, so the legacy data is migrated
    const full = cards.map((c) => ({ description: '', due: '', priority: 'medium', ...c }))
    localStorage.setItem('kanban-board-v1', JSON.stringify({ version: 1, cards: full }))
  }, cards)
  await page.reload()
}

async function seedBoards(page: Page, boards: { id: string; name: string; cards: Seed[] }[], activeBoardId = boards[0].id) {
  await page.goto('/')
  await page.evaluate(({ boards, activeBoardId }) => {
    localStorage.clear()
    const full = boards.map((b) => ({ ...b, cards: b.cards.map((c) => ({ description: '', due: '', priority: 'medium', ...c })) }))
    localStorage.setItem('kanban-workspace-v2', JSON.stringify({ version: 2, activeBoardId, boards: full }))
  }, { boards, activeBoardId })
  await page.reload()
}

const switcher = (page: Page) => page.getByLabel('Board', { exact: true })
const boardOptions = (page: Page) => switcher(page).locator('option').allTextContents()

async function cardMenu(page: Page, title: string, item: string) {
  await card(page, title).getByRole('button', { name: /More actions/ }).click()
  await page.getByRole('menu').getByRole('menuitem', { name: item }).click()
}

const column = (page: Page, id: string) => page.locator(`[data-column="${id}"]`)
const card = (page: Page, title: string) => page.locator('article[data-card-id]', { has: page.getByRole('heading', { name: title, exact: true }) })
const titlesIn = (page: Page, id: string) => column(page, id).locator('article h3').allTextContents()
const shot = (page: Page, name: string) => page.screenshot({ path: `shots/${test.info().project.name}-${name}.png`, fullPage: true })

async function fillCard(page: Page, opts: { title: string; description?: string; due?: string; priority?: 'Low' | 'Medium' | 'High' }) {
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Title').fill(opts.title)
  if (opts.description !== undefined) await dialog.getByLabel(/Description/).fill(opts.description)
  if (opts.due !== undefined) await dialog.getByLabel(/Due date/).fill(opts.due)
  if (opts.priority) await dialog.getByText(opts.priority, { exact: true }).click()
}

async function center(l: Locator) {
  const b = (await l.boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('three columns with counts and empty states', async ({ page }) => {
  for (const [id, name] of [['todo', 'To do'], ['doing', 'In progress'], ['done', 'Done']]) {
    await expect(page.getByRole('heading', { level: 2, name, exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Doing' })).toHaveCount(0)
    await expect(page.getByTestId(`count-${id}`)).toContainText('0')
  }
  await expect(page.getByText('Nothing to do yet — add a card')).toBeVisible()
  await expect(page.getByText('Nothing in progress')).toBeVisible()
  await expect(page.getByText('Nothing done yet')).toBeVisible()
  await shot(page, 'empty')
  // No horizontal scrolling at this width.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('add, edit and delete a card with confirmation', async ({ page }) => {
  await page.getByRole('button', { name: '+ Add card' }).click()
  // Title is required.
  await page.getByRole('dialog').getByRole('button', { name: 'Add card' }).click()
  await expect(page.getByText('Title is required.')).toBeVisible()
  await fillCard(page, { title: 'Write report', description: 'Quarterly numbers', due: isoOffset(3), priority: 'High' })
  await shot(page, 'add-dialog')
  // Nothing in the dialog overflows its box (caught a 375px layout bug).
  const dlg = (await page.getByRole('dialog').boundingBox())!
  for (const l of await page.getByRole('dialog').locator('label span, input, button').all()) {
    const b = await l.boundingBox()
    if (b) expect(b.x + b.width).toBeLessThanOrEqual(dlg.x + dlg.width)
  }
  await page.getByRole('dialog').getByRole('button', { name: 'Add card' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()

  const c = card(page, 'Write report')
  await expect(c).toBeVisible()
  await expect(c).toContainText('High')
  await expect(c).toContainText('Quarterly numbers')
  await expect(c).toContainText('Due')
  await expect(page.getByTestId('count-todo')).toHaveText('1')

  // Add straight into a specific column.
  await page.getByRole('button', { name: 'Add card to Done' }).click()
  await fillCard(page, { title: 'Old task' })
  await page.keyboard.press('Enter')
  await expect(column(page, 'done').getByRole('heading', { name: 'Old task' })).toBeVisible()
  await expect(card(page, 'Old task')).toContainText('Medium')

  // Edit.
  await c.getByRole('button', { name: /Edit/ }).click()
  await expect(page.getByRole('dialog').getByLabel('Title')).toHaveValue('Write report')
  await fillCard(page, { title: 'Write final report', description: '', due: '', priority: 'Low' })
  await page.getByRole('button', { name: 'Save changes' }).click()
  const edited = card(page, 'Write final report')
  await expect(edited).toContainText('Low')
  await expect(edited).not.toContainText('Quarterly')
  await expect(edited).not.toContainText('Due')

  // Cancel the edit dialog with Escape — no change.
  await edited.getByRole('button', { name: /Edit/ }).click()
  await page.getByRole('dialog').getByLabel('Title').fill('Should not save')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(edited).toBeVisible()

  // Delete: cancel first, then confirm.
  await cardMenu(page, 'Write final report', 'Delete…')
  await expect(page.getByRole('dialog')).toContainText('Delete card?')
  await expect(page.getByRole('dialog')).toContainText('Write final report')
  await shot(page, 'confirm-delete')
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await expect(edited).toBeVisible()
  await cardMenu(page, 'Write final report', 'Delete…')
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(edited).toHaveCount(0)
  await expect(page.getByTestId('count-todo')).toHaveText('0')
})

test('keyboard: move between columns and reorder', async ({ page }) => {
  await seed(page, [
    { id: 'a', title: 'Alpha', column: 'todo' },
    { id: 'b', title: 'Bravo', column: 'todo' },
  ])
  const a = card(page, 'Alpha')
  await a.focus()
  await page.keyboard.press('Shift+ArrowRight')
  expect(await titlesIn(page, 'doing')).toEqual(['Alpha'])
  await expect(card(page, 'Alpha')).toBeFocused() // focus follows the card
  await page.keyboard.press('Shift+ArrowRight')
  expect(await titlesIn(page, 'done')).toEqual(['Alpha'])
  await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('Shift+ArrowLeft')
  expect(await titlesIn(page, 'todo')).toEqual(['Bravo', 'Alpha'])
  await page.keyboard.press('Shift+ArrowUp')
  expect(await titlesIn(page, 'todo')).toEqual(['Alpha', 'Bravo'])
  await expect(page.locator('[aria-live="polite"]')).toContainText('position 1 of 2')

  // The "Move to" select is reachable with Tab and operable with the keyboard.
  await card(page, 'Bravo').focus()
  await page.keyboard.press('Tab')
  const select = card(page, 'Bravo').getByLabel(/Move .* to column/)
  await expect(select).toBeFocused()
  await select.selectOption('done')
  expect(await titlesIn(page, 'done')).toEqual(['Bravo'])
})

test('WIP limit warning on Doing above 3 cards', async ({ page }) => {
  await seed(page, [
    { id: '1', title: 'One', column: 'doing' },
    { id: '2', title: 'Two', column: 'doing' },
    { id: '3', title: 'Three', column: 'doing' },
    { id: '4', title: 'Four', column: 'todo' },
  ])
  await expect(page.getByTestId('count-doing')).toHaveText('3 / 3')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await card(page, 'Four').getByLabel(/Move .* to column/).selectOption('doing')
  await expect(page.getByRole('alert')).toContainText('Work-in-progress limit exceeded: 4 cards in In progress (limit 3)')
  await expect(page.getByTestId('count-doing')).toHaveText('4 / 3')
  await shot(page, 'wip')
  await card(page, 'One').getByLabel(/Move .* to column/).selectOption('done')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('search and priority filter with no-results state', async ({ page }) => {
  await seed(page, [
    { id: '1', title: 'Buy milk', column: 'todo', priority: 'low' },
    { id: '2', title: 'Fix bug', description: 'The login crash', column: 'doing', priority: 'high' },
    { id: '3', title: 'Ship release', column: 'done', priority: 'high' },
  ])
  const search = page.getByRole('searchbox', { name: 'Search cards' })
  await search.fill('LOGIN') // matches description, case-insensitive
  await expect(page.locator('article[data-card-id]')).toHaveCount(1)
  await expect(card(page, 'Fix bug')).toBeVisible()
  await expect(page.getByTestId('count-todo')).toHaveText('0/1')
  await expect(column(page, 'todo').getByText('No matching cards')).toBeVisible()

  await search.fill('milk') // matches title
  await expect(page.locator('article[data-card-id]')).toHaveCount(1)

  await search.fill('')
  await page.getByLabel('Filter by priority').selectOption('high')
  await expect(page.locator('article[data-card-id]')).toHaveCount(2)
  await search.fill('ship')
  await expect(page.locator('article[data-card-id]')).toHaveCount(1)

  await search.fill('zzz')
  await expect(page.getByText(/No cards match your search/)).toBeVisible()
  await shot(page, 'no-results')
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(search).toHaveValue('')
  await expect(page.locator('article[data-card-id]')).toHaveCount(3)
})

test('overdue cards are highlighted unless done', async ({ page }) => {
  await seed(page, [
    { id: '1', title: 'Late', column: 'todo', due: isoOffset(-1) },
    { id: '2', title: 'Today', column: 'todo', due: isoOffset(0) },
    { id: '3', title: 'Late but done', column: 'done', due: isoOffset(-5) },
  ])
  await expect(card(page, 'Late')).toHaveAttribute('data-overdue', 'true')
  await expect(card(page, 'Late')).toContainText('Overdue')
  await expect(card(page, 'Today')).not.toHaveAttribute('data-overdue')
  await expect(card(page, 'Late but done')).not.toHaveAttribute('data-overdue')
  await shot(page, 'overdue')
  await card(page, 'Late').getByLabel(/Move .* to column/).selectOption('done')
  await expect(card(page, 'Late')).not.toHaveAttribute('data-overdue')
})

test('card titles in Done are struck through', async ({ page }) => {
  await seed(page, [
    { id: '1', title: 'Open task', column: 'todo' },
    { id: '2', title: 'Busy task', column: 'doing' },
    { id: '3', title: 'Finished task', column: 'done' },
  ])
  const deco = (title: string) =>
    page.getByRole('heading', { name: title, exact: true }).evaluate((el) => getComputedStyle(el).textDecorationLine)
  expect(await deco('Finished task')).toBe('line-through')
  expect(await deco('Open task')).toBe('none')
  expect(await deco('Busy task')).toBe('none')
  await shot(page, 'done-strikethrough')
  // Moving into Done adds the strikethrough; moving out removes it.
  await card(page, 'Open task').getByLabel(/Move .* to column/).selectOption('done')
  await expect.poll(() => deco('Open task')).toBe('line-through')
  await card(page, 'Finished task').getByLabel(/Move .* to column/).selectOption('doing')
  await expect.poll(() => deco('Finished task')).toBe('none')
})

test('board survives reload', async ({ page }) => {
  await page.getByRole('button', { name: '+ Add card' }).click()
  await fillCard(page, { title: 'Persist me', priority: 'High', due: isoOffset(1), description: 'desc' })
  await page.keyboard.press('Enter')
  await card(page, 'Persist me').getByLabel(/Move .* to column/).selectOption('doing')
  await page.reload()
  const c = card(page, 'Persist me')
  await expect(column(page, 'doing').getByRole('heading', { name: 'Persist me' })).toBeVisible()
  await expect(c).toContainText('High')
  await expect(c).toContainText('desc')
})

test('mouse drag and drop between and within columns', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'mouse drag runs at desktop size')
  await seed(page, [
    { id: 'a', title: 'Alpha', column: 'todo' },
    { id: 'b', title: 'Bravo', column: 'todo' },
    { id: 'c', title: 'Charlie', column: 'todo' },
    { id: 'd', title: 'Delta', column: 'doing' },
  ])
  // Reorder: drag Charlie above Alpha.
  let from = await center(card(page, 'Charlie').locator('h3'))
  let to = await center(card(page, 'Alpha'))
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.box.y + 5, { steps: 10 })
  await expect(page.getByTestId('drop-indicator')).toBeVisible()
  await shot(page, 'dragging')
  await page.mouse.up()
  expect(await titlesIn(page, 'todo')).toEqual(['Charlie', 'Alpha', 'Bravo'])

  // Between columns: drag Alpha below Delta.
  from = await center(card(page, 'Alpha').locator('h3'))
  to = await center(card(page, 'Delta'))
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.box.y + to.box.height - 5, { steps: 10 })
  await page.mouse.up()
  expect(await titlesIn(page, 'doing')).toEqual(['Delta', 'Alpha'])
  // Into the empty Done column.
  from = await center(card(page, 'Bravo').locator('h3'))
  to = await center(column(page, 'done'))
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await page.mouse.up()
  expect(await titlesIn(page, 'done')).toEqual(['Bravo'])
  // Escape cancels a drag.
  from = await center(card(page, 'Charlie').locator('h3'))
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect(await titlesIn(page, 'todo')).toEqual(['Charlie'])
  // A click (no movement) on Edit still works and no dialog opened by drags.
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.reload()
  expect(await titlesIn(page, 'doing')).toEqual(['Delta', 'Alpha'])
})

test('touch drag and drop via the grip handle', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'touch drag runs at mobile size')
  await seed(page, [
    { id: 'a', title: 'Alpha', column: 'todo' },
    { id: 'b', title: 'Bravo', column: 'todo' },
    { id: 'd', title: 'Delta', column: 'doing' },
  ])
  const cdp = await page.context().newCDPSession(page)
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
  async function touchDrag(from: { x: number; y: number }, to: () => Promise<{ x: number; y: number }>) {
    await touch('touchStart', from.x, from.y)
    let p = from
    const target = await to()
    for (let i = 1; i <= 12; i++) {
      p = { x: from.x + ((target.x - from.x) * i) / 12, y: from.y + ((target.y - from.y) * i) / 12 }
      await touch('touchMove', p.x, p.y)
    }
    const final = await to()
    await touch('touchMove', final.x, final.y)
    await touch('touchEnd', final.x, final.y)
  }
  const handle = (title: string) => center(card(page, title).locator('[data-drag-handle]'))

  // Reorder within To do: Bravo above Alpha.
  await touchDrag(await handle('Bravo'), async () => {
    const b = (await card(page, 'Alpha').boundingBox())!
    return { x: b.x + b.width / 2, y: b.y + 5 }
  })
  await expect.poll(() => titlesIn(page, 'todo')).toEqual(['Bravo', 'Alpha'])

  // Between columns: Alpha into Doing below Delta. Put both on screen, away from the auto-scroll edges.
  await page.evaluate(() => window.scrollTo(0, 0))
  await column(page, 'todo').locator('h2').evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await touchDrag(await handle('Alpha'), async () => {
    const b = (await card(page, 'Delta').boundingBox())!
    return { x: b.x + b.width / 2, y: b.y + b.height - 5 }
  })
  await expect.poll(() => titlesIn(page, 'doing')).toEqual(['Delta', 'Alpha'])

  // Touching the card body (not the handle) scrolls instead of dragging.
  const body = await center(card(page, 'Bravo').locator('h3'))
  await touch('touchStart', body.x, body.y)
  for (let i = 1; i <= 5; i++) await touch('touchMove', body.x, body.y + i * 20)
  await touch('touchEnd', body.x, body.y + 100)
  expect(await titlesIn(page, 'todo')).toEqual(['Bravo'])

  // Drag to the Done column, which is below the fold: hold near the bottom edge to auto-scroll.
  const vh = page.viewportSize()!.height
  const start = await handle('Bravo')
  await touch('touchStart', start.x, start.y)
  for (let i = 1; i <= 8; i++) await touch('touchMove', start.x, start.y + ((vh - 10 - start.y) * i) / 8)
  await expect.poll(async () => {
    await touch('touchMove', start.x, vh - 10)
    const b = (await column(page, 'done').boundingBox())!
    return b.y + 40 < vh - 80
  }, { timeout: 10_000 }).toBe(true)
  const done = (await column(page, 'done').boundingBox())!
  await touch('touchMove', done.x + done.width / 2, Math.min(done.y + done.height / 2, vh - 80))
  await touch('touchEnd', done.x + done.width / 2, done.y + done.height / 2)
  await expect.poll(() => titlesIn(page, 'done')).toEqual(['Bravo'])
  await page.reload()
  expect(await titlesIn(page, 'doing')).toEqual(['Delta', 'Alpha'])
  expect(await titlesIn(page, 'done')).toEqual(['Bravo'])
})

test('screenshot of a populated board', async ({ page }) => {
  await seed(page, [
    { id: '1', title: 'Plan sprint', description: 'Pick stories for next week', column: 'todo', priority: 'high', due: isoOffset(-2) },
    { id: '2', title: 'Buy groceries', column: 'todo', priority: 'low', due: isoOffset(4) },
    { id: '3', title: 'Write blog post', description: 'About Kanban', column: 'doing', priority: 'medium' },
    { id: '4', title: 'Tax return', column: 'done', priority: 'high', due: isoOffset(-10) },
  ])
  await shot(page, 'board')
})

// ---------------------------------------------------------------- multiple boards

test.describe('multiple boards', () => {
  test('existing single-board data becomes the first board without losing cards', async ({ page }) => {
    const legacy = [
      { id: 'a', title: 'Alpha', description: 'first', column: 'todo', priority: 'high', due: isoOffset(-1) },
      { id: 'b', title: 'Bravo', column: 'todo', priority: 'low' },
      { id: 'c', title: 'Charlie', column: 'doing', priority: 'medium', due: isoOffset(5) },
      { id: 'd', title: 'Delta', column: 'done' },
    ] as const
    await seed(page, [...legacy])
    expect(await boardOptions(page)).toEqual(['My board (4)'])
    expect(await titlesIn(page, 'todo')).toEqual(['Alpha', 'Bravo'])
    expect(await titlesIn(page, 'doing')).toEqual(['Charlie'])
    expect(await titlesIn(page, 'done')).toEqual(['Delta'])
    await expect(card(page, 'Alpha')).toContainText('High')
    await expect(card(page, 'Alpha')).toContainText('first')
    await expect(card(page, 'Alpha')).toHaveAttribute('data-overdue', 'true')
    await shot(page, 'migrated')

    // Saved in the new format; the old data is left untouched as a safety net.
    const stored = await page.evaluate(() => ({
      v2: JSON.parse(localStorage.getItem('kanban-workspace-v2') ?? 'null'),
      v1: JSON.parse(localStorage.getItem('kanban-board-v1') ?? 'null'),
    }))
    expect(stored.v2.boards).toHaveLength(1)
    expect(stored.v2.boards[0].cards.map((c: { id: string }) => c.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(stored.v1.cards).toHaveLength(4)

    // Changes after migration persist (and the migration doesn't re-run over them).
    await cardMenu(page, 'Bravo', 'Delete…')
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await page.reload()
    expect(await titlesIn(page, 'todo')).toEqual(['Alpha'])
    expect(await boardOptions(page)).toEqual(['My board (3)'])
  })

  test('create, switch, rename and delete boards, each with its own cards', async ({ page }) => {
    await seed(page, [{ id: 'a', title: 'Home task', column: 'doing' }])
    const deleteBtn = page.getByRole('button', { name: 'Delete board' })
    await expect(deleteBtn).toBeDisabled() // never delete the last board

    // Create.
    await page.getByRole('button', { name: '+ New board' }).click()
    const nameInput = page.getByRole('dialog').getByLabel('Board name')
    await expect(nameInput).toHaveValue('Board 2')
    await nameInput.fill('   ')
    await page.getByRole('button', { name: 'Create board' }).click()
    await expect(page.getByText('Board name is required.')).toBeVisible()
    await nameInput.fill('my BOARD')
    await page.getByRole('button', { name: 'Create board' }).click()
    await expect(page.getByText('A board with this name already exists.')).toBeVisible()
    await nameInput.fill('Work')
    await shot(page, 'new-board-dialog')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toBeHidden()

    // The new board is active, with its own empty columns.
    await expect(switcher(page)).toHaveValue(await switcher(page).locator('option', { hasText: 'Work' }).getAttribute('value') as string)
    expect(await boardOptions(page)).toEqual(['My board (1)', 'Work (0)'])
    await expect(page.locator('article[data-card-id]')).toHaveCount(0)
    await expect(page.getByText('Nothing to do yet — add a card')).toBeVisible()
    await expect(deleteBtn).toBeEnabled()

    await page.getByRole('button', { name: 'Add card to In progress' }).click()
    await fillCard(page, { title: 'Work task' })
    await page.keyboard.press('Enter')
    expect(await titlesIn(page, 'doing')).toEqual(['Work task'])

    // Switch back: the first board's cards are untouched.
    await switcher(page).selectOption({ label: 'My board (1)' })
    expect(await titlesIn(page, 'doing')).toEqual(['Home task'])
    await switcher(page).selectOption({ label: 'Work (1)' })
    expect(await titlesIn(page, 'doing')).toEqual(['Work task'])

    // Rename (duplicate rejected, own name re-cased is fine).
    await page.getByRole('button', { name: 'Rename' }).click()
    await expect(nameInput).toHaveValue('Work')
    await nameInput.fill('My Board')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('A board with this name already exists.')).toBeVisible()
    await nameInput.fill('Office')
    await page.getByRole('button', { name: 'Save' }).click()
    expect(await boardOptions(page)).toEqual(['My board (1)', 'Office (1)'])
    // Escape cancels a rename.
    await page.getByRole('button', { name: 'Rename' }).click()
    await nameInput.fill('Nope')
    await page.keyboard.press('Escape')
    expect(await boardOptions(page)).toEqual(['My board (1)', 'Office (1)'])

    // Reload keeps boards, names and the active board.
    await page.reload()
    expect(await boardOptions(page)).toEqual(['My board (1)', 'Office (1)'])
    expect(await titlesIn(page, 'doing')).toEqual(['Work task'])

    // Delete with confirmation: cancel first, then confirm.
    await deleteBtn.click()
    await expect(page.getByRole('dialog')).toContainText('Delete board?')
    await expect(page.getByRole('dialog')).toContainText('“Office” and its 1 card will be permanently deleted')
    await shot(page, 'delete-board-dialog')
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
    expect(await boardOptions(page)).toEqual(['My board (1)', 'Office (1)'])
    await deleteBtn.click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete board' }).click()
    expect(await boardOptions(page)).toEqual(['My board (1)'])
    expect(await titlesIn(page, 'doing')).toEqual(['Home task']) // fell back to the remaining board
    await expect(deleteBtn).toBeDisabled()
    await page.reload()
    expect(await boardOptions(page)).toEqual(['My board (1)'])
    await expect(deleteBtn).toBeDisabled()
  })

  test('"Move to board…" in the card menu moves a card, keeping its column', async ({ page }) => {
    await seedBoards(page, [
      { id: 'home', name: 'Home', cards: [
        { id: 'a', title: 'Fix sink', column: 'doing', priority: 'high', description: 'leaky' },
        { id: 'b', title: 'Mow lawn', column: 'todo' },
      ] },
      { id: 'work', name: 'Work', cards: [{ id: 'c', title: 'Email boss', column: 'doing' }] },
      { id: 'side', name: 'Side project', cards: [] },
    ])
    await card(page, 'Fix sink').getByRole('button', { name: /More actions/ }).click()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem')).toHaveText(['Move to board…', 'Delete…'])
    await shot(page, 'card-menu')
    await menu.getByRole('menuitem', { name: 'Move to board…' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: /Work|Side project|Home/ })).toHaveText([/Work\s*1 card/, /Side project\s*0 cards/])
    await shot(page, 'move-to-board')
    await dialog.getByRole('button', { name: /Work/ }).click()
    await expect(dialog).toBeHidden()

    // Gone from Home, which stays the active board.
    await expect(card(page, 'Fix sink')).toHaveCount(0)
    expect(await boardOptions(page)).toEqual(['Home (1)', 'Work (2)', 'Side project (0)'])
    await expect(page.locator('[aria-live="polite"]')).toContainText('Moved “Fix sink” to board “Work”')

    // Present on Work, in the same column, appended at the end, with fields intact.
    await switcher(page).selectOption({ label: 'Work (2)' })
    expect(await titlesIn(page, 'doing')).toEqual(['Email boss', 'Fix sink'])
    await expect(card(page, 'Fix sink')).toContainText('High')
    await expect(card(page, 'Fix sink')).toContainText('leaky')
    await page.reload()
    expect(await titlesIn(page, 'doing')).toEqual(['Email boss', 'Fix sink'])
  })

  test('card menu and move-to-board work with the keyboard only', async ({ page }) => {
    await seedBoards(page, [
      { id: 'home', name: 'Home', cards: [{ id: 'a', title: 'Fix sink', column: 'todo' }] },
      { id: 'work', name: 'Work', cards: [] },
    ])
    const more = card(page, 'Fix sink').getByRole('button', { name: /More actions/ })
    await more.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menuitem', { name: 'Move to board…' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: 'Delete…' })).toBeFocused()
    await page.keyboard.press('ArrowDown') // wraps
    await expect(page.getByRole('menuitem', { name: 'Move to board…' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(more).toBeFocused()

    await page.keyboard.press('ArrowDown') // opens the menu too
    await page.keyboard.press('Enter') // Move to board…
    await expect(page.getByRole('dialog').getByRole('button', { name: /Work/ })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(card(page, 'Fix sink')).toHaveCount(0)
    expect(await boardOptions(page)).toEqual(['Home (0)', 'Work (1)'])

    // Clicking outside closes the menu.
    await switcher(page).selectOption({ label: 'Work (1)' })
    await card(page, 'Fix sink').getByRole('button', { name: /More actions/ }).click()
    await expect(page.getByRole('menu')).toBeVisible()
    await page.locator('h1').click()
    await expect(page.getByRole('menu')).toHaveCount(0)
  })

  test('with a single board, "Move to board…" offers to create one and moves the card there', async ({ page }) => {
    await seed(page, [
      { id: 'a', title: 'Lonely card', column: 'done' },
      { id: 'b', title: 'Stays', column: 'todo' },
    ])
    await cardMenu(page, 'Lonely card', 'Move to board…')
    await expect(page.getByRole('dialog')).toContainText('There are no other boards yet.')
    await page.getByRole('dialog').getByRole('button', { name: 'Create a board' }).click()
    await page.getByRole('dialog').getByLabel('Board name').fill('Archive')
    await page.getByRole('button', { name: 'Create board' }).click()
    // Still on the original board; the card moved to the new one.
    expect(await boardOptions(page)).toEqual(['My board (1)', 'Archive (1)'])
    await expect(card(page, 'Lonely card')).toHaveCount(0)
    await expect(card(page, 'Stays')).toBeVisible()
    await switcher(page).selectOption({ label: 'Archive (1)' })
    expect(await titlesIn(page, 'done')).toEqual(['Lonely card'])
  })

  test('board UI fits the viewport', async ({ page }) => {
    await seedBoards(page, [
      { id: 'x', name: 'A very long board name that goes on and on and on forever', cards: [{ id: 'a', title: 'Card', column: 'todo' }] },
      { id: 'y', name: 'Short', cards: [] },
    ])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await shot(page, 'boards-header')
    await card(page, 'Card').getByRole('button', { name: /More actions/ }).click()
    const menu = (await page.getByRole('menu').boundingBox())!
    expect(menu.x).toBeGreaterThanOrEqual(0)
    expect(menu.x + menu.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  })
})
