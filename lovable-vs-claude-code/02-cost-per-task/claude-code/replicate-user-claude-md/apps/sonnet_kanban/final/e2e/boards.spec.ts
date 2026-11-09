import { expect, test, type Page } from '@playwright/test'

const sizes = [
  { name: 'desktop', width: 1280, height: 800, touch: false },
  { name: 'mobile', width: 375, height: 800, touch: true },
]

const col = (page: Page, id: 'todo' | 'doing' | 'done') => page.getByTestId(`column-${id}`)
const switcher = (page: Page) => page.getByLabel('Switch board')
const boardNames = (page: Page) => switcher(page).locator('option').allInnerTexts()
const dlg = (page: Page) => page.getByRole('dialog')

async function addCard(page: Page, column: 'todo' | 'doing' | 'done', title: string, extra: { priority?: string; due?: string } = {}) {
  await col(page, column).getByRole('button', { name: /^Add card to/ }).click()
  await dlg(page).getByLabel('Title').fill(title)
  if (extra.priority) await dlg(page).getByLabel('Priority').selectOption({ label: extra.priority })
  if (extra.due) await dlg(page).getByLabel(/Due date/).fill(extra.due)
  await dlg(page).getByRole('button', { name: 'Add card' }).click()
  await expect(dlg(page)).toBeHidden()
}

async function newBoard(page: Page, name: string) {
  await page.getByRole('button', { name: 'New board' }).click()
  await dlg(page).getByLabel('Board name').fill(name)
  await dlg(page).getByRole('button', { name: 'Create board' }).click()
  await expect(dlg(page)).toBeHidden()
}

const LEGACY = {
  cards: {
    a: { id: 'a', title: 'Legacy todo', description: 'old desc', dueDate: '2020-01-01', priority: 'high' },
    b: { id: 'b', title: 'Legacy doing', description: '', dueDate: '', priority: 'low' },
    c: { id: 'c', title: 'Legacy done', description: '', dueDate: '', priority: 'medium' },
    d: { id: 'd', title: 'Legacy todo 2', description: '', dueDate: '', priority: 'medium' },
  },
  columns: { todo: ['a', 'd'], doing: ['b'], done: ['c'] },
}

for (const size of sizes) {
  test.describe(`boards ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch })

    test.beforeEach(async ({ page }) => {
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())
      await page.reload()
    })

    test('data saved by the single-board version becomes the first board, nothing lost', async ({ page }) => {
      await page.evaluate((legacy) => {
        localStorage.removeItem('kanban.workspace.v1')
        localStorage.setItem('kanban.board.v1', JSON.stringify(legacy))
      }, LEGACY)
      await page.reload()
      expect(await boardNames(page)).toEqual(['My board'])
      await expect(col(page, 'todo').getByTestId('card-title')).toHaveText(['Legacy todo', 'Legacy todo 2'])
      await expect(col(page, 'doing').getByTestId('card')).toContainText('Legacy doing')
      await expect(col(page, 'done').getByTestId('card')).toContainText('Legacy done')
      await expect(page.getByTestId('card')).toHaveCount(4)
      await expect(col(page, 'todo').getByText('old desc')).toBeVisible()
      await expect(page.getByTestId('card').filter({ hasText: 'Legacy todo' }).first()).toHaveAttribute('data-overdue', 'true')
      // still there after another reload (now served from the workspace key)
      await page.reload()
      await expect(page.getByTestId('card')).toHaveCount(4)
      await page.screenshot({ path: `shots/${size.name}-migrated.png`, fullPage: true })
    })

    test('starts with one board; the last board cannot be deleted', async ({ page }) => {
      expect(await boardNames(page)).toEqual(['My board'])
      await expect(page.getByRole('button', { name: 'Delete board' })).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Move "x" to another board' })).toHaveCount(0)
    })

    test('create: custom and blank names, new board is empty and active, boards keep separate cards', async ({ page }) => {
      await addCard(page, 'todo', 'On first')
      await newBoard(page, 'Work')
      await expect(switcher(page)).toHaveValue(/.+/)
      expect(await boardNames(page)).toEqual(['My board', 'Work'])
      expect(await switcher(page).evaluate((s: HTMLSelectElement) => s.selectedOptions[0].text)).toBe('Work')
      await expect(page.getByTestId('card')).toHaveCount(0)
      for (const c of ['todo', 'doing', 'done'] as const) await expect(col(page, c).getByTestId('empty')).toBeVisible()
      await addCard(page, 'doing', 'On work')

      await newBoard(page, '   ') // blank -> default name
      expect(await boardNames(page)).toEqual(['My board', 'Work', 'Board 3'])
      await expect(page.getByTestId('card')).toHaveCount(0)

      await switcher(page).selectOption({ label: 'My board' })
      await expect(page.getByTestId('card')).toHaveCount(1)
      await expect(col(page, 'todo').getByTestId('card')).toContainText('On first')
      await switcher(page).selectOption({ label: 'Work' })
      await expect(page.getByTestId('card')).toHaveCount(1)
      await expect(col(page, 'doing').getByTestId('card')).toContainText('On work')
      await page.screenshot({ path: `shots/${size.name}-boards.png`, fullPage: true })
    })

    test('cancel / Escape on new board creates nothing', async ({ page }) => {
      await page.getByRole('button', { name: 'New board' }).click()
      await dlg(page).getByLabel('Board name').fill('Nope')
      await dlg(page).getByRole('button', { name: 'Cancel' }).click()
      await page.getByRole('button', { name: 'New board' }).click()
      await page.keyboard.press('Escape')
      expect(await boardNames(page)).toEqual(['My board'])
    })

    test('rename: validates, updates the switcher, persists', async ({ page }) => {
      await page.getByRole('button', { name: 'Rename' }).click()
      await expect(dlg(page).getByLabel('Board name')).toHaveValue('My board')
      await dlg(page).getByLabel('Board name').fill('   ')
      await dlg(page).getByRole('button', { name: 'Save' }).click()
      await expect(dlg(page).getByText('Name is required.')).toBeVisible()
      await dlg(page).getByLabel('Board name').fill('Personal')
      await dlg(page).getByRole('button', { name: 'Save' }).click()
      await expect(dlg(page)).toBeHidden()
      expect(await boardNames(page)).toEqual(['Personal'])
      await page.reload()
      expect(await boardNames(page)).toEqual(['Personal'])
    })

    test('delete: confirmation, cancel keeps, confirm removes and switches; last board protected', async ({ page }) => {
      await addCard(page, 'todo', 'Keep me')
      await newBoard(page, 'Temp')
      await addCard(page, 'todo', 'T1')
      await addCard(page, 'done', 'T2')

      await page.getByRole('button', { name: 'Delete board' }).click()
      await expect(dlg(page)).toContainText('Delete this board?')
      await expect(dlg(page)).toContainText('“Temp” and its 2 cards')
      await dlg(page).getByRole('button', { name: 'Cancel' }).click()
      expect(await boardNames(page)).toEqual(['My board', 'Temp'])
      await expect(page.getByTestId('card')).toHaveCount(2)

      await page.getByRole('button', { name: 'Delete board' }).click()
      await dlg(page).getByRole('button', { name: 'Delete board' }).click()
      await expect(dlg(page)).toBeHidden()
      expect(await boardNames(page)).toEqual(['My board'])
      expect(await switcher(page).evaluate((s: HTMLSelectElement) => s.selectedOptions[0].text)).toBe('My board')
      await expect(col(page, 'todo').getByTestId('card')).toContainText('Keep me')
      await expect(page.getByRole('button', { name: 'Delete board' })).toBeDisabled()
      await page.reload()
      expect(await boardNames(page)).toEqual(['My board'])
      await expect(page.getByTestId('card')).toHaveCount(1)
    })

    test('Move to board…: disabled with one board; moves card with its data to the chosen board and column', async ({ page }) => {
      await addCard(page, 'doing', 'Traveller', { priority: 'High', due: '2020-02-02' })
      await addCard(page, 'todo', 'Stay put')
      await expect(page.getByRole('button', { name: 'Move "Traveller" to another board' })).toBeDisabled()

      await newBoard(page, 'Other')
      await switcher(page).selectOption({ label: 'My board' })
      await page.getByRole('button', { name: 'Move "Traveller" to another board' }).click()
      await expect(dlg(page)).toContainText('Move “Traveller” to another board')
      // only other boards offered, column defaults to the current one
      expect(await dlg(page).getByLabel('Destination board').locator('option').allInnerTexts()).toEqual(['Other'])
      await expect(dlg(page).getByLabel('Column')).toHaveValue('doing')
      await dlg(page).getByLabel('Column').selectOption({ label: 'Done' })
      await dlg(page).getByRole('button', { name: 'Move card' }).click()
      await expect(dlg(page)).toBeHidden()

      // gone from source, source count updated
      await expect(page.getByTestId('card-title').getByText('Traveller')).toHaveCount(0)
      await expect(page.getByTestId('card')).toHaveCount(1)
      await expect(col(page, 'doing').getByTestId('empty')).toBeVisible()
      await expect(col(page, 'doing').getByTestId('count')).toContainText('0')

      // arrived in destination Done with fields intact (done -> struck through, so not overdue)
      await switcher(page).selectOption({ label: 'Other' })
      const card = col(page, 'done').getByTestId('card').filter({ hasText: 'Traveller' })
      await expect(card).toBeVisible()
      await expect(card.getByTestId('priority-label')).toHaveText('High')
      await expect(card.getByTestId('due')).toContainText('2020')
      await expect(card).toHaveAttribute('data-overdue', 'false')
      await expect(col(page, 'done').getByTestId('count')).toHaveText('1')

      // it is a normal card there: move it with the keyboard button, and it survives reload
      await page.getByRole('button', { name: 'Move "Traveller" to In progress' }).click()
      await page.reload()
      await expect(col(page, 'doing').getByTestId('card')).toContainText('Traveller')
      await expect(col(page, 'doing').getByTestId('card')).toHaveAttribute('data-overdue', 'true')
      await page.screenshot({ path: `shots/${size.name}-moved.png`, fullPage: true })
    })

    test('Move to board dialog can be cancelled without moving', async ({ page }) => {
      await addCard(page, 'todo', 'Stay')
      await newBoard(page, 'B2')
      await switcher(page).selectOption({ label: 'My board' })
      await page.getByRole('button', { name: 'Move "Stay" to another board' }).click()
      await page.keyboard.press('Escape')
      await expect(page.getByTestId('card')).toHaveCount(1)
    })

    test('with three boards the dialog lists the other two; WIP limit applies per board', async ({ page }) => {
      for (const t of ['W1', 'W2', 'W3', 'W4']) await addCard(page, 'doing', t)
      await expect(page.getByTestId('wip-warning')).toBeVisible()
      await newBoard(page, 'Two')
      await newBoard(page, 'Three')
      await expect(page.getByTestId('wip-warning')).toHaveCount(0) // empty board, no warning
      await switcher(page).selectOption({ label: 'My board' })
      await expect(page.getByTestId('wip-warning')).toBeVisible()
      await page.getByRole('button', { name: 'Move "W1" to another board' }).click()
      expect(await dlg(page).getByLabel('Destination board').locator('option').allInnerTexts()).toEqual(['Two', 'Three'])
      await dlg(page).getByRole('button', { name: 'Move card' }).click()
      await expect(page.getByTestId('wip-warning')).toHaveCount(0) // back to 3
      await switcher(page).selectOption({ label: 'Two' })
      await expect(col(page, 'doing').getByTestId('card')).toContainText('W1')
    })

    test('active board and filters: selection persists on reload; search resets when switching', async ({ page }) => {
      await addCard(page, 'todo', 'Alpha')
      await newBoard(page, 'Second')
      await addCard(page, 'todo', 'Beta')
      await page.getByLabel('Search cards').fill('zzz')
      await expect(page.getByTestId('no-results')).toBeVisible()
      await switcher(page).selectOption({ label: 'My board' })
      await expect(page.getByLabel('Search cards')).toHaveValue('')
      await expect(page.getByTestId('card')).toHaveCount(1)
      await page.reload()
      expect(await switcher(page).evaluate((s: HTMLSelectElement) => s.selectedOptions[0].text)).toBe('My board')
      await expect(page.getByTestId('card')).toContainText('Alpha')
    })

    test('board bar does not overflow the page and fits the viewport', async ({ page }) => {
      await newBoard(page, 'A rather long board name to test wrapping')
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow).toBeLessThanOrEqual(0)
      // the switcher must be genuinely usable: visible, wide enough to read, inside the viewport
      const sw = (await switcher(page).boundingBox())!
      expect(sw.width).toBeGreaterThanOrEqual(150)
      expect(sw.x + sw.width).toBeLessThanOrEqual(size.width)
      for (const name of ['New board', 'Rename', 'Delete board']) {
        const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!
        expect(box.x + box.width).toBeLessThanOrEqual(size.width)
      }
    })
  })
}
