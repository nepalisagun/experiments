import { expect, test, type Page } from '@playwright/test'

const sizes = [
  { name: 'desktop', width: 1280, height: 800, mobile: false },
  { name: 'mobile', width: 375, height: 740, mobile: true },
]

for (const size of sizes) {
  test.describe(`tags ${size.name} ${size.width}px`, () => {
    test.use({ viewport: { width: size.width, height: size.height } })

    const shot = (page: Page, name: string) => page.screenshot({ path: `shots/${size.name}-tags-${name}.png` })
    const noteTitles = (page: Page) => page.getByTestId('note-title').allInnerTexts()
    const tagRows = (page: Page) => page.getByTestId('tag-item')
    const tagRow = (page: Page, tag: string) => tagRows(page).filter({ hasText: new RegExp(`^#${tag}\\s*\\d+$`) })
    const backToList = async (page: Page) => {
      if (size.mobile) await page.getByRole('button', { name: 'Back to notes' }).click()
    }
    const openNote = async (page: Page, title: string) =>
      page.getByTestId('note-item').filter({ hasText: title }).first().click()

    /** Seeds three notes directly into storage. */
    test.beforeEach(async ({ page }) => {
      await page.goto('/')
      await page.evaluate(() => {
        const t = Date.now()
        const note = (id: string, title: string, content: string, ago: number) => ({
          id,
          title,
          content,
          pinned: false,
          createdAt: t - ago,
          updatedAt: t - ago,
        })
        localStorage.setItem(
          'md-notes:v1',
          JSON.stringify([
            note('1', 'Groceries', 'Milk and eggs #home #shopping', 1000),
            note('2', 'Sprint', 'Ship it #work\n\n```\n#notatag\n```\n`#nope`', 2000),
            note('3', 'Chores', 'Fix the sink #Home and #work-items', 3000),
          ]),
        )
      })
      await page.reload()
    })

    test('sidebar lists every tag with its note count', async ({ page }) => {
      await expect(tagRows(page)).toHaveText([/^#home\s*2$/, /^#shopping\s*1$/, /^#work\s*1$/, /^#work-items\s*1$/])
      await shot(page, '01-list')
    })

    test('clicking a tag filters the list; clicking again clears it', async ({ page }) => {
      await tagRow(page, 'home').click()
      await expect(tagRow(page, 'home')).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(() => noteTitles(page)).toEqual(['Groceries', 'Chores'])
      // Combines with search
      await page.getByLabel('Search notes').fill('sink')
      await expect.poll(() => noteTitles(page)).toEqual(['Chores'])
      await page.getByLabel('Search notes').fill('')
      await shot(page, '02-filtered')
      await tagRow(page, 'home').click()
      await expect(tagRow(page, 'home')).toHaveAttribute('aria-pressed', 'false')
      await expect.poll(() => noteTitles(page)).toEqual(['Groceries', 'Sprint', 'Chores'])
      // Switching straight to another tag
      await tagRow(page, 'home').click()
      await tagRow(page, 'work').click()
      await expect.poll(() => noteTitles(page)).toEqual(['Sprint'])
    })

    test('tags are live: editing a note updates tags and counts', async ({ page }) => {
      await openNote(page, 'Sprint')
      const editor = page.getByLabel('Markdown source')
      await editor.fill('')
      await editor.pressSequentially('Ship it #work #urgent')
      if (!size.mobile) {
        // Caret still on the word: not counted yet. Leaving the word commits it.
        await expect(tagRow(page, 'urgent')).toHaveCount(0)
        await editor.blur()
      }
      await backToList(page)
      await expect(tagRow(page, 'urgent')).toHaveText(/1$/)
      await openNote(page, 'Sprint')
      await editor.fill('No tags now')
      await backToList(page)
      await expect(tagRow(page, 'urgent')).toHaveCount(0)
      await expect(tagRow(page, 'work')).toHaveCount(0)
    })

    test('typing # suggests existing tags; Enter inserts the chosen one', async ({ page }) => {
      await openNote(page, 'Sprint')
      const editor = page.getByLabel('Markdown source')
      await editor.fill('')
      await editor.pressSequentially('Plan #')
      const list = page.getByRole('listbox', { name: 'Tag suggestions' })
      await expect(list).toBeVisible()
      // Every existing tag (this note's own #work was removed by the fill)
      await expect(list.getByRole('option')).toHaveText(['#home', '#shopping', '#work-items'])
      await editor.pressSequentially('w')
      await expect(list.getByRole('option')).toHaveText(['#work-items'])
      await shot(page, '03-suggest')
      if (!size.mobile) {
        // The half-typed #w is not listed as a tag while the caret is on it
        await expect(tagRow(page, 'w')).toHaveCount(0)
        await editor.press('Escape')
        await editor.pressSequentially(' ')
        await expect(tagRow(page, 'w')).toHaveCount(1)
        await editor.press('Backspace')
        await editor.press('ArrowLeft')
        await editor.press('ArrowRight')
        await expect(list).toBeVisible()
      }
      await editor.press('Enter')
      await expect(editor).toHaveValue('Plan #work-items ')
      await expect(list).toBeHidden()
      // The caret is after the inserted tag: typing continues there.
      await editor.pressSequentially('next')
      await expect(editor).toHaveValue('Plan #work-items next')

      // Arrow keys move the selection
      await editor.pressSequentially(' #')
      await editor.press('ArrowDown')
      await expect(list.getByRole('option', { selected: true })).toHaveText('#shopping')
      await editor.press('Enter')
      await expect(editor).toHaveValue('Plan #work-items next #shopping ')

      // Escape closes; Enter then makes a newline
      await editor.pressSequentially('#h')
      await expect(list).toBeVisible()
      await editor.press('Escape')
      await expect(list).toBeHidden()
      await editor.press('Enter')
      await expect(editor).toHaveValue('Plan #work-items next #shopping #h\n')

      // A complete existing tag: nothing to suggest, so Enter is a newline
      await editor.pressSequentially('#home')
      await expect(list).toBeHidden()
      await editor.press('Enter')
      await expect(editor).toHaveValue('Plan #work-items next #shopping #h\n#home\n')

      // No suggestions after "# " (a heading)
      await editor.pressSequentially('# ')
      await expect(list).toBeHidden()

      // Undo restores the text before an inserted suggestion
      await editor.fill('x #sh')
      await editor.press('End')
      await editor.press('ArrowLeft')
      await editor.press('ArrowRight')
      await expect(list).toBeVisible()
      await editor.press('Enter')
      await expect(editor).toHaveValue('x #shopping ')
      await editor.press('Control+z')
      await expect(editor).toHaveValue('x #sh')
    })

    test('clicking a suggestion inserts it', async ({ page }) => {
      await openNote(page, 'Groceries')
      const editor = page.getByLabel('Markdown source')
      await editor.fill('Buy bread')
      await editor.press('End')
      await editor.pressSequentially(' #wo')
      const list = page.getByRole('listbox', { name: 'Tag suggestions' })
      await expect(list.getByRole('option')).toHaveText(['#work', '#work-items'])
      // Popup stays inside the viewport
      const box = (await list.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(size.width)
      await list.getByRole('option', { name: '#work', exact: true }).click()
      await expect(editor).toHaveValue('Buy bread #work ')
      await expect(editor).toBeFocused()
      await expect(list).toBeHidden()
      // Mid-text: suggestion replaces only the partial tag
      await editor.fill('a #ho b')
      await editor.press('Home')
      for (let i = 0; i < 5; i++) await editor.press('ArrowRight')
      await expect(list).toBeVisible()
      await list.getByRole('option', { name: '#home' }).click()
      await expect(editor).toHaveValue('a #home b')
    })

    test('renaming a tag rewrites it in every note', async ({ page }) => {
      await tagRow(page, 'home').click() // filter on it: the filter follows the rename
      await page.getByRole('button', { name: 'Rename tag #home' }).click()
      const input = page.getByLabel('New name for #home')
      await expect(input).toBeFocused()
      // Invalid name: error, nothing changes
      await input.fill('two words')
      await input.press('Enter')
      await expect(page.getByRole('alert')).toContainText('letters')
      await shot(page, '04-rename-error')
      await input.fill('#household')
      await input.press('Enter')
      await expect(tagRow(page, 'household')).toHaveText(/2$/)
      await expect(tagRow(page, 'home')).toHaveCount(0)
      await expect(tagRow(page, 'household')).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(() => noteTitles(page)).toHaveLength(2)

      await openNote(page, 'Groceries')
      await expect(page.getByLabel('Markdown source')).toHaveValue('Milk and eggs #household #shopping')
      await backToList(page)
      await openNote(page, 'Chores')
      // #Home (other case) is renamed; #work-items is untouched
      await expect(page.getByLabel('Markdown source')).toHaveValue('Fix the sink #household and #work-items')
      await backToList(page)

      // Renaming #work leaves #work-items and the code block alone
      await tagRow(page, 'household').click()
      await page.getByRole('button', { name: 'Rename tag #work', exact: true }).click()
      await page.getByLabel('New name for #work', { exact: true }).fill('job')
      await page.getByLabel('New name for #work', { exact: true }).press('Enter')
      await openNote(page, 'Sprint')
      await expect(page.getByLabel('Markdown source')).toHaveValue('Ship it #job\n\n```\n#notatag\n```\n`#nope`')
      await backToList(page)
      await expect(tagRow(page, 'work-items')).toHaveCount(1)

      // Escape cancels a rename
      await page.getByRole('button', { name: 'Rename tag #job' }).click()
      await page.getByLabel('New name for #job').fill('zzz')
      await page.getByLabel('New name for #job').press('Escape')
      await expect(tagRow(page, 'job')).toHaveCount(1)

      // Renaming onto an existing tag merges the counts
      await page.getByRole('button', { name: 'Rename tag #job' }).click()
      await page.getByLabel('New name for #job').fill('shopping')
      await page.getByLabel('New name for #job').press('Enter')
      await expect(tagRow(page, 'shopping')).toHaveText(/2$/)

      // Survives a reload
      await page.waitForTimeout(600)
      await page.reload()
      await expect(tagRows(page)).toHaveText([/^#household\s*2$/, /^#shopping\s*2$/, /^#work-items\s*1$/])
      await shot(page, '05-renamed')
    })

    test('tags render as chips in the preview; clicking one filters', async ({ page }) => {
      await openNote(page, 'Sprint')
      const preview = page.getByTestId('preview')
      await expect(preview.locator('.tag')).toHaveText(['#work'])
      await expect(preview.locator('pre')).toContainText('#notatag')
      await shot(page, '06-chips')
      await preview.locator('.tag').click()
      await expect(page.getByTestId('note-list')).toBeVisible()
      await expect(tagRow(page, 'work')).toHaveAttribute('aria-pressed', 'true')
      await expect.poll(() => noteTitles(page)).toEqual(['Sprint'])
    })
  })
}
