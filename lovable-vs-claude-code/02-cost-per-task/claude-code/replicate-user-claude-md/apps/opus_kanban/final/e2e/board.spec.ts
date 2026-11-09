import { expect, type Locator, type Page, test } from '@playwright/test'

// Runs in two projects (playwright.config.ts): desktop 1280px with a mouse, mobile 375px with touch.

const column = (page: Page, id: 'todo' | 'doing' | 'done') => page.locator(`[data-column="${id}"]`)
const card = (page: Page, title: string) => page.locator('li[data-card-id]', { has: page.getByRole('heading', { name: title, exact: true }) })
const titlesIn = (page: Page, id: 'todo' | 'doing' | 'done') => column(page, id).locator('li[data-card-id] h3').allTextContents()

async function addCard(page: Page, col: 'todo' | 'doing' | 'done', title: string, opts: { description?: string; due?: string; priority?: 'Low' | 'Medium' | 'High' } = {}) {
  await column(page, col).getByRole('button', { name: /^Add card to/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Title').fill(title)
  if (opts.description) await dialog.getByLabel(/Description/).fill(opts.description)
  if (opts.due) await dialog.getByLabel(/Due date/).fill(opts.due)
  if (opts.priority) await dialog.getByText(opts.priority, { exact: true }).click()
  await dialog.getByRole('button', { name: 'Add card' }).click()
  await expect(dialog).toBeHidden()
}

/** Opens a card's "⋯" menu and picks an item. */
async function cardAction(page: Page, title: string, item: string) {
  await card(page, title).getByRole('button', { name: `Actions for “${title}”` }).click()
  await page.getByRole('menu').getByRole('menuitem', { name: item }).click()
}

/** Switches boards by name (option labels also carry a card count). */
async function switchTo(page: Page, name: string) {
  const value = await page.locator('#board-select option').filter({ hasText: new RegExp(`^${name} \\(\\d+\\)$`) }).getAttribute('value')
  await page.getByLabel('Current board').selectOption(value!)
}

async function createBoard(page: Page, name: string) {
  await page.getByRole('button', { name: 'New board' }).click()
  const dialog = page.getByRole('dialog', { name: 'New board' })
  await dialog.getByLabel('Board name').fill(name)
  await dialog.getByRole('button', { name: 'Create board' }).click()
  await expect(dialog).toBeHidden()
}

const currentBoard = (page: Page) => page.getByLabel('Current board').evaluate((s: HTMLSelectElement) => s.selectedOptions[0].textContent)

/** Drags with the mouse on desktop and with real touch events on mobile (via CDP). */
async function dragTo(page: Page, from: Locator, to: Locator, where: 'top' | 'bottom' = 'top', isMobile = false) {
  await from.scrollIntoViewIfNeeded()
  const handle = isMobile ? from.locator('[data-grip]') : from.locator('h3')
  const a = (await handle.boundingBox())!
  const b0 = (await to.boundingBox())!
  const sx = a.x + a.width / 2
  const sy = a.y + a.height / 2
  const tx = b0.x + b0.width / 2
  const ty = where === 'top' ? b0.y + 4 : b0.y + b0.height - 4
  if (!isMobile) {
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    for (let i = 1; i <= 12; i++) await page.mouse.move(sx + ((tx - sx) * i) / 12, sy + ((ty - sy) * i) / 12)
    await page.mouse.up()
    return
  }
  const cdp = await page.context().newCDPSession(page)
  const touch = (type: string, x: number, y: number) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
  const vh = page.viewportSize()!.height
  await touch('touchStart', sx, sy)
  // If the target is off-screen, hold the finger near the edge so the app auto-scrolls to it.
  const cx = sx
  let cy = sy
  const SAFE = 70 // outside the app's 64px auto-scroll zone
  for (let tries = 0; tries < 200; tries++) {
    const b = (await to.boundingBox())!
    if (b.y + b.height > SAFE + 20 && b.y < vh - SAFE - 20) break // enough of the target is visible
    cy = b.y >= vh - SAFE - 20 ? vh - 20 : 20
    await touch('touchMove', cx, cy)
    await page.waitForTimeout(30)
  }
  const b = (await to.boundingBox())!
  const gx = b.x + b.width / 2
  const want = where === 'top' ? b.y + 4 : b.y + b.height - 4
  const gy = Math.min(Math.max(want, SAFE, b.y + 2), vh - SAFE, b.y + b.height - 2)
  for (let i = 1; i <= 8; i++) await touch('touchMove', cx + ((gx - cx) * i) / 8, cy + ((gy - cy) * i) / 8)
  await touch('touchEnd', gx, gy)
  await cdp.detach()
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('empty board shows three columns, counts and empty states', async ({ page }, info) => {
  for (const [id, name] of [['todo', 'To do'], ['doing', 'In progress'], ['done', 'Done']] as const) {
    await expect(column(page, id).getByRole('heading', { name, level: 2 })).toBeVisible()
    await expect(page.getByTestId(`count-${id}`)).toContainText('0')
    await expect(column(page, id).getByText('No cards yet')).toBeVisible()
  }
  await page.screenshot({ path: `shots/${info.project.name}-empty.png`, fullPage: true })
})

test('add, edit and delete a card with confirmation', async ({ page }) => {
  // Title is required.
  await column(page, 'todo').getByRole('button', { name: 'Add card to To do' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Add card' }).click()
  await expect(page.getByRole('alert')).toHaveText('Title is required.')
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()

  await addCard(page, 'todo', 'Buy milk', { description: 'Semi-skimmed', due: '2099-05-01', priority: 'High' })
  const c = card(page, 'Buy milk')
  await expect(c).toContainText('Semi-skimmed')
  await expect(c).toContainText('High')
  await expect(c).toContainText('2099')
  const labelBg = await c.locator('.prio-high').evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(labelBg).not.toBe('rgba(0, 0, 0, 0)') // coloured label, not transparent
  await expect(page.getByTestId('count-todo')).toHaveText('1')

  // Edit by clicking the card.
  await c.locator('h3').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Title')).toHaveValue('Buy milk')
  await dialog.getByLabel('Title').fill('Buy oat milk')
  await dialog.getByText('Low', { exact: true }).click()
  await dialog.getByLabel(/Due date/).fill('')
  await dialog.getByRole('button', { name: 'Save' }).click()
  const edited = card(page, 'Buy oat milk')
  await expect(edited).toContainText('Low')
  await expect(edited).not.toContainText('Due')

  // Delete from the card menu: cancel keeps it, confirm removes it.
  await cardAction(page, 'Buy oat milk', 'Delete')
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('Buy oat milk')
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(edited).toBeVisible()
  await expect(edited.getByRole('button', { name: /^Actions for/ })).toBeFocused() // focus returns to the menu button
  await cardAction(page, 'Buy oat milk', 'Delete')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(edited).toHaveCount(0)
  await expect(page.getByTestId('count-todo')).toHaveText('0')

  // Delete from inside the edit dialog also asks first.
  await addCard(page, 'done', 'Old task')
  await card(page, 'Old task').locator('h3').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(card(page, 'Old task')).toHaveCount(0)
})

test('drag between columns and reorder within a column', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile'
  await addCard(page, 'todo', 'A')
  await addCard(page, 'todo', 'B')
  await addCard(page, 'todo', 'C')

  // Reorder: drag C to the top of To do.
  await dragTo(page, card(page, 'C'), card(page, 'A'), 'top', mobile)
  await expect.poll(() => titlesIn(page, 'todo')).toEqual(['C', 'A', 'B'])

  // Reorder: drag C to below B.
  await dragTo(page, card(page, 'C'), card(page, 'B'), 'bottom', mobile)
  await expect.poll(() => titlesIn(page, 'todo')).toEqual(['A', 'B', 'C'])

  // Move to another column (empty In progress).
  await dragTo(page, card(page, 'A'), column(page, 'doing'), 'bottom', mobile)
  await expect.poll(() => titlesIn(page, 'doing')).toEqual(['A'])
  await expect.poll(() => titlesIn(page, 'todo')).toEqual(['B', 'C'])

  // Drop before an existing card in another column.
  await dragTo(page, card(page, 'C'), card(page, 'A'), 'top', mobile)
  await expect.poll(() => titlesIn(page, 'doing')).toEqual(['C', 'A'])
  await expect(page.getByTestId('count-doing')).toContainText('2')

  // A drag does not open the editor.
  await expect(page.getByRole('dialog')).toBeHidden()

  // Survives reload.
  await page.reload()
  await expect.poll(() => titlesIn(page, 'doing')).toEqual(['C', 'A'])
  await expect.poll(() => titlesIn(page, 'todo')).toEqual(['B'])
})

test('mid-drag shows a ghost and drop indicator; Escape cancels', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'mouse-only check')
  await addCard(page, 'todo', 'Ghost')
  await addCard(page, 'doing', 'Target')
  const a = (await card(page, 'Ghost').locator('h3').boundingBox())!
  const t = (await card(page, 'Target').boundingBox())!
  await page.mouse.move(a.x + 5, a.y + 5)
  await page.mouse.down()
  await page.mouse.move(a.x + 50, a.y + 20, { steps: 3 })
  await page.mouse.move(t.x + 40, t.y + 5, { steps: 8 })
  await expect(page.locator('body.dragging')).toHaveCount(1)
  await expect(column(page, 'doing').locator('li[aria-hidden].bg-blue-500')).toHaveCount(1)
  await page.screenshot({ path: 'shots/desktop-middrag.png' })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(page.locator('body.dragging')).toHaveCount(0)
  expect(await titlesIn(page, 'todo')).toEqual(['Ghost'])
  expect(await titlesIn(page, 'doing')).toEqual(['Target'])
  await expect(page.getByRole('dialog')).toBeHidden()
})

test('keyboard moves a card between columns and reorders it', async ({ page }) => {
  await addCard(page, 'todo', 'K1')
  await addCard(page, 'todo', 'K2')

  // Visible move buttons work and keep focus on the card.
  await card(page, 'K1').getByRole('button', { name: 'Move to In progress' }).focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => titlesIn(page, 'doing')).toEqual(['K1'])
  await expect(card(page, 'K1').getByRole('button', { name: 'Move to Done' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect.poll(() => titlesIn(page, 'done')).toEqual(['K1'])
  await expect(card(page, 'K1')).toBeFocused() // "Move to Done" no longer exists, focus falls back to the card

  // Alt+Arrow shortcuts on the focused card.
  await page.keyboard.press('Alt+ArrowLeft')
  await expect.poll(() => titlesIn(page, 'doing')).toEqual(['K1'])
  await expect(card(page, 'K1')).toBeFocused()
  await page.keyboard.press('Alt+ArrowLeft')
  await expect.poll(() => titlesIn(page, 'todo')).toEqual(['K2', 'K1'])
  await page.keyboard.press('Alt+ArrowUp')
  await expect.poll(() => titlesIn(page, 'todo')).toEqual(['K1', 'K2'])
  await expect(page.locator('[aria-live]')).toContainText('moved to To do, position 1 of 2')

  // Enter opens the editor, Escape closes it; Delete asks for confirmation.
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await card(page, 'K1').focus()
  await page.keyboard.press('Delete')
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(card(page, 'K1')).toBeVisible()
})

test('WIP limit warning on In progress above 3 cards', async ({ page }, info) => {
  for (const t of ['W1', 'W2', 'W3']) await addCard(page, 'doing', t)
  await expect(page.getByTestId('count-doing')).toHaveText('3 / 3')
  await expect(page.getByText(/WIP limit exceeded/)).toHaveCount(0)
  await addCard(page, 'doing', 'W4')
  await expect(page.getByText(/WIP limit exceeded: 4 cards in In progress/)).toBeVisible()
  await expect(page.getByTestId('count-doing')).toHaveText('4 / 3')
  await page.screenshot({ path: `shots/${info.project.name}-wip.png`, fullPage: true })
  await card(page, 'W4').getByRole('button', { name: 'Move to Done' }).click()
  await expect(page.getByText(/WIP limit exceeded/)).toHaveCount(0)
})

test('search, priority filter and no-results state', async ({ page }, info) => {
  await addCard(page, 'todo', 'Write report', { description: 'quarterly numbers', priority: 'High' })
  await addCard(page, 'doing', 'Call plumber', { priority: 'Low' })
  await addCard(page, 'done', 'Pay invoice', { description: 'Report attached', priority: 'Medium' })

  const search = page.getByRole('searchbox', { name: 'Search cards' })
  await search.fill('REPORT')
  await expect(card(page, 'Write report')).toBeVisible()
  await expect(card(page, 'Pay invoice')).toBeVisible() // matched by description
  await expect(card(page, 'Call plumber')).toHaveCount(0)
  await expect(column(page, 'doing').getByText(/No matching cards/)).toBeVisible()
  await expect(page.getByTestId('count-doing')).toHaveText('0 / 1')

  await page.getByLabel('Filter by priority').selectOption('high')
  await expect(card(page, 'Write report')).toBeVisible()
  await expect(card(page, 'Pay invoice')).toHaveCount(0)

  await search.fill('nothing like this')
  await expect(page.getByText(/No cards match “nothing like this” with High priority/)).toBeVisible()
  await page.screenshot({ path: `shots/${info.project.name}-noresults.png`, fullPage: true })
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(search).toHaveValue('')
  await expect(page.locator('li[data-card-id]')).toHaveCount(3)
})

test('overdue cards are highlighted unless done', async ({ page }, info) => {
  await addCard(page, 'todo', 'Late', { due: '2020-01-01', priority: 'High' })
  await addCard(page, 'todo', 'Future', { due: '2099-01-01' })
  const today = await page.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  await addCard(page, 'todo', 'Today', { due: today })
  await expect(card(page, 'Late').locator('[data-overdue]')).toHaveCount(1)
  await expect(card(page, 'Late')).toContainText('Overdue')
  await expect(card(page, 'Future').locator('[data-overdue]')).toHaveCount(0)
  await expect(card(page, 'Today').locator('[data-overdue]')).toHaveCount(0)
  await page.screenshot({ path: `shots/${info.project.name}-overdue.png`, fullPage: true })
  await card(page, 'Late').getByRole('button', { name: 'Move to In progress' }).click()
  await expect(card(page, 'Late')).toContainText('Overdue')
  await card(page, 'Late').getByRole('button', { name: 'Move to Done' }).click()
  await expect(card(page, 'Late')).not.toContainText('Overdue')
})

test('Done card titles are struck through, others are not', async ({ page }, info) => {
  await addCard(page, 'todo', 'Open task')
  await addCard(page, 'doing', 'Busy task')
  await addCard(page, 'done', 'Shipped task')
  const deco = (title: string) => card(page, title).locator('h3').evaluate((el) => getComputedStyle(el).textDecorationLine)
  expect(await deco('Shipped task')).toBe('line-through')
  expect(await deco('Open task')).toBe('none')
  expect(await deco('Busy task')).toBe('none')
  // Moving out of Done removes it; moving in adds it.
  await card(page, 'Shipped task').getByRole('button', { name: 'Move to In progress' }).click()
  expect(await deco('Shipped task')).toBe('none')
  await card(page, 'Busy task').getByRole('button', { name: 'Move to Done' }).click()
  expect(await deco('Busy task')).toBe('line-through')
  await page.reload()
  expect(await deco('Busy task')).toBe('line-through')
  await page.screenshot({ path: `shots/${info.project.name}-renamed.png`, fullPage: true })
})

test('board survives reload, including all fields', async ({ page }, info) => {
  await addCard(page, 'todo', 'Persist me', { description: 'details', due: '2099-12-31', priority: 'High' })
  await addCard(page, 'doing', 'In progress')
  await addCard(page, 'done', 'Finished', { priority: 'Low' })
  await page.reload()
  await expect(card(page, 'Persist me')).toContainText('details')
  await expect(card(page, 'Persist me')).toContainText('High')
  await expect(card(page, 'Persist me')).toContainText('2099')
  expect(await titlesIn(page, 'doing')).toEqual(['In progress'])
  expect(await titlesIn(page, 'done')).toEqual(['Finished'])
  await page.screenshot({ path: `shots/${info.project.name}-board.png`, fullPage: true })

  // Corrupt storage does not crash the app.
  await page.evaluate(() => localStorage.setItem('personal-kanban.workspace.v2', '{broken'))
  await page.reload()
  await expect(column(page, 'todo').getByText('No cards yet')).toBeVisible()
})

test('no horizontal overflow and dialog fits the viewport', async ({ page }, info) => {
  await addCard(page, 'todo', 'A very long title that keeps going and going without stopping to check the width of the card at all', {
    description: 'Supercalifragilisticexpialidocious-and-another-very-long-unbroken-word-to-test-wrapping-behaviour',
  })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBe(0)
  await column(page, 'todo').getByRole('button', { name: 'Add card to To do' }).click()
  const box = (await page.getByRole('dialog').boundingBox())!
  const vw = page.viewportSize()!.width
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(vw)
  await page.screenshot({ path: `shots/${info.project.name}-dialog.png` })
})

// ---------- multiple boards ----------

test('data saved by the single-board version becomes the first board, nothing lost', async ({ page }, info) => {
  const legacy = {
    todo: [
      { id: 'l1', title: 'Legacy one', description: 'with notes', due: '2020-02-02', priority: 'high' },
      { id: 'l2', title: 'Legacy two', description: '', due: '', priority: 'low' },
    ],
    doing: [1, 2, 3, 4].map((n) => ({ id: `d${n}`, title: `Busy ${n}`, description: '', due: '', priority: 'medium' })),
    done: [{ id: 'x1', title: 'Old win', description: '', due: '', priority: 'medium' }],
  }
  await page.evaluate((data) => {
    localStorage.clear()
    localStorage.setItem('personal-kanban.board.v1', JSON.stringify(data))
  }, legacy)
  await page.reload()

  expect(await currentBoard(page)).toBe('My board (7)')
  await expect(page.locator('#board-select option')).toHaveCount(1)
  expect(await titlesIn(page, 'todo')).toEqual(['Legacy one', 'Legacy two'])
  expect(await titlesIn(page, 'doing')).toEqual(['Busy 1', 'Busy 2', 'Busy 3', 'Busy 4'])
  expect(await titlesIn(page, 'done')).toEqual(['Old win'])
  await expect(card(page, 'Legacy one')).toContainText('with notes')
  await expect(card(page, 'Legacy one')).toContainText('Overdue')
  await expect(page.getByText(/WIP limit exceeded/)).toBeVisible()
  await page.screenshot({ path: `shots/${info.project.name}-migrated.png`, fullPage: true })

  // The migrated board is now stored in the new format and keeps working after a reload.
  await addCard(page, 'todo', 'After migration')
  await page.reload()
  expect(await titlesIn(page, 'todo')).toEqual(['Legacy one', 'Legacy two', 'After migration'])
  // The old key is left untouched (safe rollback).
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('personal-kanban.board.v1')!).todo.length)).toBe(2)
})

test('create, switch, rename and delete boards; each board has its own cards', async ({ page }, info) => {
  await addCard(page, 'todo', 'Work card')
  expect(await currentBoard(page)).toBe('My board (1)')

  // Deleting the only board is not possible.
  await expect(page.getByRole('button', { name: 'Delete board' })).toBeDisabled()

  // Create: validation, then a new empty, active board.
  await page.getByRole('button', { name: 'New board' }).click()
  const dialog = page.getByRole('dialog', { name: 'New board' })
  await dialog.getByRole('button', { name: 'Create board' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Board name is required.')
  await dialog.getByLabel('Board name').fill('  my BOARD ')
  await dialog.getByRole('button', { name: 'Create board' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('A board with this name already exists.')
  await dialog.getByLabel('Board name').fill('Home')
  await dialog.getByRole('button', { name: 'Create board' }).click()
  await expect(dialog).toBeHidden()
  expect(await currentBoard(page)).toBe('Home (0)')
  await expect(page).toHaveTitle('Home · My Kanban')
  for (const id of ['todo', 'doing', 'done'] as const) await expect(column(page, id).getByText('No cards yet')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete board' })).toBeEnabled()

  // Each board keeps its own cards.
  await addCard(page, 'doing', 'Home card')
  await switchTo(page, 'My board')
  expect(await titlesIn(page, 'todo')).toEqual(['Work card'])
  await expect(card(page, 'Home card')).toHaveCount(0)
  await switchTo(page, 'Home')
  expect(await titlesIn(page, 'doing')).toEqual(['Home card'])
  await expect(card(page, 'Work card')).toHaveCount(0)

  // Rename (Escape cancels; duplicate rejected; valid name applied).
  await page.getByRole('button', { name: 'Rename board' }).click()
  const rename = page.getByRole('dialog', { name: 'Rename board' })
  await expect(rename.getByLabel('Board name')).toHaveValue('Home')
  await page.keyboard.press('Escape')
  await expect(rename).toBeHidden()
  await expect(page.getByRole('button', { name: 'Rename board' })).toBeFocused()
  await page.getByRole('button', { name: 'Rename board' }).click()
  await rename.getByLabel('Board name').fill('My board')
  await rename.getByRole('button', { name: 'Rename' }).click()
  await expect(rename.getByRole('alert')).toHaveText('A board with this name already exists.')
  await rename.getByLabel('Board name').fill('Household')
  await rename.getByRole('button', { name: 'Rename' }).click()
  expect(await currentBoard(page)).toBe('Household (1)')
  await page.screenshot({ path: `shots/${info.project.name}-boards.png`, fullPage: true })

  // Active board and names survive a reload.
  await page.reload()
  expect(await currentBoard(page)).toBe('Household (1)')
  expect(await titlesIn(page, 'doing')).toEqual(['Home card'])

  // Delete: confirmation names the board and card count; Cancel keeps it.
  await page.getByRole('button', { name: 'Delete board' }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('“Household” and its 1 card will be removed permanently.')
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  expect(await currentBoard(page)).toBe('Household (1)')
  await page.getByRole('button', { name: 'Delete board' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete board' }).click()
  await expect(page.locator('#board-select option')).toHaveCount(1)
  expect(await currentBoard(page)).toBe('My board (1)')
  expect(await titlesIn(page, 'todo')).toEqual(['Work card'])
  await expect(page.getByLabel('Current board')).toBeFocused()
  await expect(page.getByRole('button', { name: 'Delete board' })).toBeDisabled()
  await page.reload()
  await expect(page.locator('#board-select option')).toHaveCount(1)
})

test('card menu: "Move to board…" moves a card to another board and column', async ({ page }, info) => {
  await addCard(page, 'todo', 'Movable', { description: 'keep me', due: '2099-03-03', priority: 'High' })
  await addCard(page, 'todo', 'Stays')

  // With one board, the item is there but disabled with a hint.
  await card(page, 'Movable').getByRole('button', { name: 'Actions for “Movable”' }).click()
  const item = page.getByRole('menuitem', { name: /Move to board/ })
  await expect(item).toHaveAttribute('aria-disabled', 'true')
  await expect(item).toContainText('Create another board first')
  await item.click({ force: true }) // a click on the disabled item does nothing
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)

  await createBoard(page, 'Archive')
  await createBoard(page, 'Someday')
  await switchTo(page, 'My board')

  // Keyboard: open the menu, arrow to the item, Enter.
  const menuButton = card(page, 'Movable').getByRole('button', { name: 'Actions for “Movable”' })
  await menuButton.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'Edit' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: 'Move to board…' })).toBeFocused()
  await page.screenshot({ path: `shots/${info.project.name}-menu.png` })
  await page.keyboard.press('Enter')

  const dialog = page.getByRole('dialog', { name: 'Move to board' })
  await expect(dialog).toContainText('“Movable”')
  await expect(dialog.getByRole('radio')).toHaveCount(2) // the current board is not offered
  await expect(dialog.getByLabel('Column')).toHaveValue('todo') // defaults to the card's current column
  await dialog.getByRole('radio', { name: /Someday/ }).check()
  await dialog.getByLabel('Column').selectOption({ label: 'In progress' })
  await page.screenshot({ path: `shots/${info.project.name}-move-dialog.png` })
  await dialog.getByRole('button', { name: 'Move card' }).click()
  await expect(dialog).toBeHidden()

  // Gone from this board, still on it: nothing else changed.
  expect(await titlesIn(page, 'todo')).toEqual(['Stays'])
  await expect(page.locator('[aria-live]')).toContainText('“Movable” moved to board “Someday”, In progress.')
  expect(await currentBoard(page)).toBe('My board (1)')
  await expect(page.getByRole('button', { name: 'Add card to To do' })).toBeFocused()

  // Arrived on the other board, in the chosen column, with all its data.
  await switchTo(page, 'Someday')
  expect(await titlesIn(page, 'doing')).toEqual(['Movable'])
  await expect(card(page, 'Movable')).toContainText('keep me')
  await expect(card(page, 'Movable')).toContainText('High')
  await expect(card(page, 'Movable')).toContainText('2099')
  await switchTo(page, 'Archive')
  await expect(page.locator('li[data-card-id]')).toHaveCount(0)

  // Persisted.
  await page.reload()
  await switchTo(page, 'Someday')
  expect(await titlesIn(page, 'doing')).toEqual(['Movable'])

  // Cancel leaves the card where it is.
  await cardAction(page, 'Movable', 'Move to board…')
  await page.getByRole('dialog', { name: 'Move to board' }).getByRole('button', { name: 'Cancel' }).click()
  expect(await titlesIn(page, 'doing')).toEqual(['Movable'])
})

test('card menu closes on outside click and Escape, and does not open the editor', async ({ page }) => {
  await addCard(page, 'todo', 'Menu card')
  const button = card(page, 'Menu card').getByRole('button', { name: 'Actions for “Menu card”' })
  await button.click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.getByRole('heading', { name: 'My Kanban' }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await button.click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(button).toBeFocused()
  await cardAction(page, 'Menu card', 'Edit')
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('WIP limit and filters apply per board', async ({ page }) => {
  for (const t of ['P1', 'P2', 'P3', 'P4']) await addCard(page, 'doing', t)
  await expect(page.getByText(/WIP limit exceeded/)).toBeVisible()
  await createBoard(page, 'Calm')
  await expect(page.getByText(/WIP limit exceeded/)).toHaveCount(0)
  await addCard(page, 'todo', 'P-other')
  await page.getByRole('searchbox', { name: 'Search cards' }).fill('P')
  expect(await titlesIn(page, 'todo')).toEqual(['P-other'])
  await expect(card(page, 'P1')).toHaveCount(0)
})
