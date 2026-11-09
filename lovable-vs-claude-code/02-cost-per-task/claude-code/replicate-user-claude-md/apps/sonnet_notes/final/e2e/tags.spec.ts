import { expect, test, type Page } from '@playwright/test'

const sizes = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 375, height: 700 },
]

for (const size of sizes) {
  test.describe(`tags ${size.name}`, () => {
    const mobile = size.width < 768
    test.use({ viewport: { width: size.width, height: size.height } })

    const editor = (p: Page) => p.getByLabel('Markdown editor')
    const items = (p: Page) => p.getByTestId('note-item')
    const chips = (p: Page) => p.getByTestId('tag-chip')

    async function back(p: Page) {
      if (mobile) await p.getByRole('button', { name: '← Notes' }).click()
    }
    async function create(p: Page, name: string, body: string) {
      await p.getByRole('button', { name: '+ New' }).click()
      await p.getByLabel('Note title').fill(name)
      await editor(p).fill(body)
      await back(p)
    }

    test.beforeEach(async ({ page }) => {
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())
      await page.reload()
      await create(page, 'A', 'plan #work and #ideas')
      await create(page, 'B', 'ship it #work')
      await create(page, 'C', 'no tags here, only `#code` and # heading')
    })

    test('sidebar shows tags with note counts', async ({ page }) => {
      await expect(chips(page)).toHaveCount(2)
      await expect(chips(page).nth(0)).toContainText('#ideas')
      await expect(chips(page).nth(0)).toContainText('1')
      await expect(chips(page).nth(1)).toContainText('#work')
      await expect(chips(page).nth(1)).toContainText('2')
      await page.screenshot({ path: `shots/${size.name}-tags.png` })
    })

    test('click filters, click again clears; combines with search', async ({ page }) => {
      await expect(items(page)).toHaveCount(4) // welcome + A + B + C
      await page.getByRole('button', { name: /Filter by tag #work/ }).click()
      await expect(items(page)).toHaveCount(2)
      await expect(page.getByRole('button', { name: /Filter by tag #work/ })).toHaveAttribute('aria-pressed', 'true')
      await page.getByLabel('Search notes').fill('ship')
      await expect(items(page)).toHaveCount(1)
      await page.getByLabel('Search notes').fill('')
      await page.screenshot({ path: `shots/${size.name}-tag-filter.png` })
      await page.getByRole('button', { name: /Filter by tag #work/ }).click()
      await expect(items(page)).toHaveCount(4)
      await expect(page.getByRole('button', { name: /Filter by tag #work/ })).toHaveAttribute('aria-pressed', 'false')
    })

    test('typing # suggests existing tags; Enter and click insert', async ({ page }) => {
      await page.getByRole('button', { name: '+ New' }).click()
      const ed = editor(page)
      await ed.pressSequentially('hello #')
      const box = page.getByTestId('tag-suggestions')
      await expect(box).toBeVisible()
      await expect(box.getByRole('option')).toHaveText(['#work', '#ideas'])
      await page.screenshot({ path: `shots/${size.name}-suggest.png` })
      await ed.press('ArrowDown')
      await expect(box.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true')
      await ed.press('ArrowUp')
      await ed.press('Enter')
      await expect(ed).toHaveValue('hello #work ')
      await expect(box).toHaveCount(0)
      // typing a prefix narrows; click inserts
      await ed.pressSequentially('and #id')
      await expect(box.getByRole('option')).toHaveText(['#ideas'])
      await box.getByRole('option').click()
      await expect(ed).toHaveValue('hello #work and #ideas ')
      // own half-typed tag is not suggested; Escape dismisses
      await ed.pressSequentially('#zz')
      await expect(box).toHaveCount(0)
      await ed.press('Backspace')
      await ed.press('Backspace')
      await expect(box).toBeVisible()
      await ed.press('Escape')
      await expect(box).toHaveCount(0)
      // Enter without suggestions is a normal newline
      await ed.pressSequentially(' x')
      await ed.press('Enter')
      await expect(ed).toHaveValue(/x\n$/)
    })

    test('renaming a tag renames it in every note', async ({ page }) => {
      await page.getByRole('button', { name: 'Rename tag #work' }).click()
      const input = page.getByLabel('New name for tag #work')
      await input.fill('bad name')
      await input.press('Enter')
      await expect(page.getByText('Use letters, numbers')).toBeVisible()
      await input.fill('job')
      await input.press('Enter')
      await expect(chips(page)).toHaveCount(2)
      await expect(chips(page).nth(1)).toContainText('#job')
      await expect(chips(page).nth(1)).toContainText('2')
      await expect(page.getByRole('button', { name: /Filter by tag #work/ })).toHaveCount(0)
      for (const [name, text] of [['A', 'plan #job and #ideas'], ['B', 'ship it #job']]) {
        await items(page).filter({ hasText: name }).first().locator('button').first().click()
        await expect(editor(page)).toHaveValue(text)
        await back(page)
      }
      // code occurrence in C untouched, and rename persists across reload
      await page.reload()
      await expect(chips(page).nth(1)).toContainText('#job')
      // renaming the active filter keeps the filter on the new name
      await page.getByRole('button', { name: /Filter by tag #job/ }).click()
      await page.getByRole('button', { name: 'Rename tag #job' }).click()
      await page.getByLabel('New name for tag #job').fill('Work2')
      await page.getByLabel('New name for tag #job').press('Enter')
      await expect(page.getByRole('button', { name: /Filter by tag #work2/ })).toHaveAttribute('aria-pressed', 'true')
      await expect(items(page)).toHaveCount(2)
      // Escape cancels
      await page.getByRole('button', { name: 'Rename tag #ideas' }).click()
      await page.getByLabel('New name for tag #ideas').press('Escape')
      await expect(page.getByRole('button', { name: 'Rename tag #ideas' })).toBeVisible()
    })

    test('removing the last use of the filtered tag clears the filter', async ({ page }) => {
      await page.getByRole('button', { name: /Filter by tag #ideas/ }).click()
      await expect(items(page)).toHaveCount(1)
      await items(page).first().locator('button').first().click()
      await editor(page).fill('nothing')
      await back(page)
      await expect(chips(page)).toHaveCount(1)
      await expect(items(page)).toHaveCount(4)
    })

    test('no horizontal overflow with tags', async ({ page }) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width)
    })
  })
}
