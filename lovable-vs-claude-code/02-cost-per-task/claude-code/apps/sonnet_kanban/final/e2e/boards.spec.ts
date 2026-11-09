import { expect, test, type Locator, type Page } from '@playwright/test'

const sizes = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 375, height: 700 },
]

const col = (page: Page, name: string) => page.locator(`section[aria-label="${name}"]`)
const cardIn = (page: Page, c: string, title: string) => col(page, c).locator('article', { hasText: title })
const switcher = (page: Page) => page.getByTestId('board-switcher')
const boardNames = (page: Page) => switcher(page).locator('option').allTextContents()

async function menuAction(card: Locator, item: string) {
  await card.getByRole('button', { name: /^Menu for/ }).click()
  await card.getByRole('menuitem', { name: item }).click()
}

async function add(page: Page, column: string, title: string) {
  await page.getByRole('button', { name: `Add card to ${column}` }).click()
  await page.getByRole('dialog').getByLabel('Title').fill(title)
  await page.getByRole('dialog').getByRole('button', { name: 'Add card' }).click()
}

async function newBoard(page: Page, name: string) {
  await page.getByRole('button', { name: 'New board' }).click()
  await page.getByRole('dialog').getByLabel('Board name').fill(name)
  await page.getByRole('dialog').getByRole('button', { name: 'Create board' }).click()
}

const LEGACY = {
  cards: {
    a: { id: 'a', title: 'Old todo', description: 'kept', dueDate: '2000-01-01', priority: 'high' },
    b: { id: 'b', title: 'Old doing', description: '', dueDate: '', priority: 'low' },
    c: { id: 'c', title: 'Old done', description: '', dueDate: '2000-01-01', priority: 'medium' },
  },
  columns: { todo: ['a'], doing: ['b'], done: ['c'] },
}

for (const size of sizes) {
  test.describe(`boards ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height }, hasTouch: size.name === 'mobile' })

    test.beforeEach(async ({ page }) => {
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())
      await page.reload()
    })

    test('existing saved single board becomes the first board, nothing lost', async ({ page }) => {
      await page.evaluate((legacy) => {
        localStorage.clear()
        localStorage.setItem('kanban-board-v1', JSON.stringify(legacy))
      }, LEGACY)
      await page.reload()
      expect(await boardNames(page)).toHaveLength(1)
      await expect(page.locator('article')).toHaveCount(3)
      await expect(cardIn(page, 'To do', 'Old todo')).toContainText('kept')
      await expect(cardIn(page, 'To do', 'Old todo').getByTestId('priority')).toHaveText('High')
      await expect(cardIn(page, 'To do', 'Old todo').getByTestId('overdue-badge')).toBeVisible()
      await expect(cardIn(page, 'In progress', 'Old doing')).toBeVisible()
      await expect(cardIn(page, 'Done', 'Old done')).toBeVisible()
      await expect(cardIn(page, 'Done', 'Old done').getByTestId('overdue-badge')).toBeHidden()

      // it is saved in the new format and survives reloads; the old data stays in storage untouched
      await page.reload()
      await expect(page.locator('article')).toHaveCount(3)
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem('kanban-board-v1')!).columns.todo)).toEqual(['a'])
      await page.screenshot({ path: `shots/${size.name}-migrated.png`, fullPage: true })
    })

    test('create, switch, rename, persist; boards are independent', async ({ page }) => {
      expect(await boardNames(page)).toEqual(['My board'])
      await add(page, 'To do', 'Home task')

      await newBoard(page, 'Work')
      expect(await boardNames(page)).toEqual(['My board', 'Work'])
      await expect(switcher(page)).toHaveValue(/.+/)
      await expect(page.locator('article')).toHaveCount(0) // new board starts empty, and is active
      await expect(page.getByTestId('empty-todo')).toBeVisible()
      await expect(page.getByTestId('empty-doing')).toBeVisible()
      await expect(page.getByTestId('empty-done')).toBeVisible()
      await add(page, 'In progress', 'Work task')
      await expect(page.getByTestId('count-doing')).toHaveText('1 / 3')

      await switcher(page).selectOption({ label: 'My board' })
      await expect(cardIn(page, 'To do', 'Home task')).toBeVisible()
      await expect(page.locator('article')).toHaveCount(1)
      await expect(page.getByTestId('count-doing')).toHaveText('0 / 3')

      // rename (and reject duplicates / empty)
      await page.getByRole('button', { name: 'Rename' }).click()
      const d = page.getByRole('dialog')
      await expect(d.getByLabel('Board name')).toHaveValue('My board')
      await d.getByLabel('Board name').fill('work')
      await d.getByRole('button', { name: 'Rename', exact: true }).click()
      await expect(d.getByRole('alert')).toContainText('already exists')
      await d.getByLabel('Board name').fill('   ')
      await d.getByRole('button', { name: 'Rename', exact: true }).click()
      await expect(d.getByRole('alert')).toHaveText('Name is required')
      await d.getByLabel('Board name').fill('Personal')
      await d.getByRole('button', { name: 'Rename', exact: true }).click()
      await expect(d).toBeHidden()
      expect(await boardNames(page)).toEqual(['Personal', 'Work'])

      // reload keeps boards, names, cards and the active board
      await page.reload()
      expect(await boardNames(page)).toEqual(['Personal', 'Work'])
      await expect(cardIn(page, 'To do', 'Home task')).toBeVisible()
      await switcher(page).selectOption({ label: 'Work' })
      await page.reload()
      await expect(switcher(page).locator('option:checked')).toHaveText('Work')
      await expect(cardIn(page, 'In progress', 'Work task')).toBeVisible()
      await page.screenshot({ path: `shots/${size.name}-boards.png`, fullPage: true })
    })

    test('new-board dialog validates and can be cancelled', async ({ page }) => {
      await page.getByRole('button', { name: 'New board' }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Create board' }).click()
      await expect(page.getByRole('alert')).toHaveText('Name is required')
      await page.getByLabel('Board name').fill('my BOARD')
      await page.getByRole('button', { name: 'Create board' }).click()
      await expect(page.getByRole('alert')).toContainText('already exists')
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toBeHidden()
      expect(await boardNames(page)).toEqual(['My board'])
    })

    test('delete board needs confirmation and the last board cannot be deleted', async ({ page }) => {
      const del = page.getByRole('button', { name: 'Delete board' })
      await expect(del).toBeDisabled() // only one board
      await add(page, 'To do', 'Keep me')
      await newBoard(page, 'Temp')
      await add(page, 'To do', 'Doomed 1')
      await add(page, 'Done', 'Doomed 2')
      await expect(del).toBeEnabled()

      await del.click()
      await expect(page.getByRole('dialog')).toContainText('“Temp” and its 2 card(s) will be permanently deleted')
      await page.getByRole('button', { name: 'Cancel' }).click()
      expect(await boardNames(page)).toEqual(['My board', 'Temp'])
      await expect(page.locator('article')).toHaveCount(2)

      await del.click()
      await page.getByRole('dialog').getByRole('button', { name: 'Delete board' }).click()
      expect(await boardNames(page)).toEqual(['My board'])
      await expect(cardIn(page, 'To do', 'Keep me')).toBeVisible() // switched to the remaining board
      await expect(del).toBeDisabled()
      await page.reload()
      expect(await boardNames(page)).toEqual(['My board'])
      await expect(page.locator('article')).toHaveCount(1)
      await expect(del).toBeDisabled()
    })

    test('card menu: Move to board… keeps the column and the card', async ({ page }) => {
      await add(page, 'To do', 'Wanderer')
      await add(page, 'To do', 'Stayer')
      await cardIn(page, 'To do', 'Wanderer').getByRole('button', { name: 'Move “Wanderer” to In progress' }).click()
      await cardIn(page, 'In progress', 'Wanderer').getByRole('button', { name: 'Move “Wanderer” to Done' }).click()

      // no other board yet: the dialog says so
      await menuAction(cardIn(page, 'Done', 'Wanderer'), 'Move to board…')
      await expect(page.getByRole('dialog')).toContainText('no other board')
      await expect(page.getByRole('button', { name: 'Move', exact: true })).toBeHidden()
      await page.getByRole('button', { name: 'Cancel' }).click()

      await newBoard(page, 'Other')
      await switcher(page).selectOption({ label: 'My board' })
      await menuAction(cardIn(page, 'Done', 'Wanderer'), 'Move to board…')
      const d = page.getByRole('dialog')
      expect(await d.getByRole('combobox').locator('option').allTextContents()).toEqual(['Other']) // current board excluded
      await d.getByRole('button', { name: 'Move', exact: true }).click()
      await expect(page.locator('article', { hasText: 'Wanderer' })).toHaveCount(0)
      await expect(cardIn(page, 'To do', 'Stayer')).toBeVisible()

      await switcher(page).selectOption({ label: 'Other' })
      await expect(cardIn(page, 'Done', 'Wanderer')).toBeVisible()
      await expect(cardIn(page, 'Done', 'Wanderer').getByTestId('card-title')).toHaveCSS('text-decoration-line', 'line-through')
      await page.reload()
      await expect(page.locator('article')).toHaveCount(1) // still on "Other", still there
      await expect(cardIn(page, 'Done', 'Wanderer')).toBeVisible()
    })

    test('card menu is keyboard accessible and closes on Escape / outside click', async ({ page }) => {
      await add(page, 'To do', 'Menu card')
      const card = cardIn(page, 'To do', 'Menu card')
      const trigger = card.getByRole('button', { name: /^Menu for/ })
      await trigger.focus()
      await page.keyboard.press('Enter')
      await expect(card.getByRole('menu')).toBeVisible()
      await expect(card.getByRole('menuitem', { name: 'Edit' })).toBeFocused()
      await page.keyboard.press('ArrowDown')
      await expect(card.getByRole('menuitem', { name: 'Move to board…' })).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(card.getByRole('menu')).toBeHidden()
      await expect(trigger).toBeFocused()
      await trigger.click()
      await expect(card.getByRole('menu')).toBeVisible()
      await page.getByRole('heading', { name: 'Kanban' }).click()
      await expect(card.getByRole('menu')).toBeHidden()
      await trigger.click()
      await page.screenshot({ path: `shots/${size.name}-menu.png` })
    })

    test('no horizontal overflow with several boards and long names', async ({ page }) => {
      await newBoard(page, 'A very long board name that goes on and on')
      await newBoard(page, 'Another')
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)
    })
  })
}
