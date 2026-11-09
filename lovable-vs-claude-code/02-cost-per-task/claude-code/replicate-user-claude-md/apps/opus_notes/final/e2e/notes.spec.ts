import { expect, test, type Page } from '@playwright/test'

const sizes = [
  { name: 'desktop', width: 1280, height: 800, mobile: false },
  { name: 'mobile', width: 375, height: 740, mobile: true },
]

for (const size of sizes) {
  test.describe(`${size.name} ${size.width}px`, () => {
    test.use({ viewport: { width: size.width, height: size.height } })

    const shot = (page: Page, name: string) => page.screenshot({ path: `shots/${size.name}-${name}.png` })
    const items = (page: Page) => page.getByTestId('note-item')
    const backToList = async (page: Page) => {
      if (size.mobile) await page.getByRole('button', { name: 'Back to notes' }).click()
    }
    const newNote = async (page: Page, title: string, body: string) => {
      await page.getByRole('button', { name: '+ New' }).click()
      await page.getByLabel('Note title').fill(title)
      await page.getByLabel('Markdown source').fill(body)
      await backToList(page)
    }

    test.beforeEach(async ({ page }) => {
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())
      await page.reload()
    })

    test('layout, welcome note and live preview', async ({ page }) => {
      // Loading the page is not an edit: no "Saving…" flash.
      await expect(page.getByTestId('save-status')).toHaveText('✓ Saved', { timeout: 100 })
      await expect(items(page)).toHaveCount(1)
      await expect(items(page).first()).toContainText('Welcome')
      await expect(page.getByTestId('tag-item')).toHaveText([/^#welcome\s*1$/])
      await shot(page, '01-start')
      await items(page).first().click()

      const editor = page.getByLabel('Markdown source')
      const preview = page.getByTestId('preview')
      await expect(editor).toBeVisible()
      await expect(preview).toBeVisible()

      // Side by side on desktop, stacked on mobile.
      const e = (await editor.boundingBox())!
      const p = (await preview.boundingBox())!
      if (size.mobile) {
        expect(p.y).toBeGreaterThanOrEqual(e.y + e.height - 1)
        expect(Math.abs(p.x - e.x)).toBeLessThan(2)
        await expect(page.getByRole('complementary', { name: 'Notes' })).toBeHidden()
      } else {
        expect(p.x).toBeGreaterThanOrEqual(e.x + e.width - 1)
        expect(Math.abs(p.y - e.y)).toBeLessThan(2)
        await expect(page.getByRole('complementary', { name: 'Notes' })).toBeVisible()
      }
      // No horizontal page scroll.
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width)

      await editor.fill(
        '# Head\n## Sub\n**bold** and *ital*\n\n- one\n- two\n\n1. first\n\n[link](https://example.com)\n\n```\ncode **here**\n```\n\n- [ ] task',
      )
      await expect(preview.locator('h1')).toHaveText('Head')
      await expect(preview.locator('h2')).toHaveText('Sub')
      await expect(preview.locator('strong')).toHaveText('bold')
      await expect(preview.locator('em')).toHaveText('ital')
      await expect(preview.locator('ul > li').first()).toHaveText('one')
      await expect(preview.locator('ol > li')).toHaveText('first')
      await expect(preview.locator('a')).toHaveAttribute('href', 'https://example.com')
      await expect(preview.locator('pre code')).toHaveText('code **here**')
      await expect(preview.locator('input[type=checkbox]')).toHaveCount(1)
      await shot(page, '02-editor')

      // A short note on mobile: the preview sits directly under the editor, no gap.
      await editor.fill('short')
      const e2 = (await editor.boundingBox())!
      const p2 = (await preview.boundingBox())!
      if (size.mobile) expect(Math.abs(p2.y - (e2.y + e2.height))).toBeLessThan(2)
    })

    test('create, rename, delete with confirmation', async ({ page }) => {
      await page.getByRole('button', { name: '+ New' }).click()
      const title = page.getByLabel('Note title')
      await expect(title).toBeFocused()
      await expect(title).toHaveValue('Untitled note')
      await page.keyboard.type('Groceries') // title text is selected, so typing replaces it
      await expect(title).toHaveValue('Groceries')
      await backToList(page)
      await expect(items(page)).toHaveCount(2)
      await expect(items(page).first()).toContainText('Groceries')

      // Rename
      await items(page).first().click()
      await title.fill('Weekly groceries')
      await backToList(page)
      await expect(items(page).first()).toContainText('Weekly groceries')

      // Delete → cancel keeps it
      await items(page).first().click()
      await page.getByRole('button', { name: 'Delete' }).click()
      const dialog = page.getByRole('alertdialog')
      await expect(dialog).toContainText('Weekly groceries')
      await shot(page, '03-confirm')
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toBeHidden()
      await page.getByRole('button', { name: 'Delete' }).click()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      await expect(title).toHaveValue('Weekly groceries')

      // Delete → confirm removes it
      await page.getByRole('button', { name: 'Delete' }).click()
      await dialog.getByRole('button', { name: 'Delete' }).click()
      await backToList(page).catch(() => {})
      await expect(items(page)).toHaveCount(1)
      await expect(items(page).first()).not.toContainText('groceries')

      // Delete the last note → empty-state text
      await items(page).first().click()
      await page.getByRole('button', { name: 'Delete' }).click()
      await dialog.getByRole('button', { name: 'Delete' }).click()
      await expect(items(page)).toHaveCount(0)
      await expect(page.getByTestId('note-list')).toHaveText('Nothing here yet. Create your first note.')
      await page.reload()
      await expect(page.getByText('Nothing here yet. Create your first note.')).toBeVisible()
      await shot(page, '08-empty')
    })

    test('word count sits at the bottom right of the editor', async ({ page }) => {
      await items(page).first().click()
      await page.getByLabel('Markdown source').fill('one two three')
      const wc = page.getByTestId('word-count')
      await expect(wc).toHaveText('3 words')
      const main = (await page.getByRole('main').boundingBox())!
      const box = (await wc.boundingBox())!
      // Right edge within the side padding, bottom edge within the footer strip.
      expect(main.x + main.width - (box.x + box.width)).toBeLessThan(20)
      expect(main.y + main.height - (box.y + box.height)).toBeLessThan(12)
      expect(box.y + box.height).toBeLessThanOrEqual(size.height)
      // Stays put with a long note (not pushed off-screen on mobile).
      await page.getByLabel('Markdown source').fill('word\n\n'.repeat(200))
      await expect(wc).toHaveText('200 words')
      const box2 = (await wc.boundingBox())!
      expect(Math.abs(box2.y - box.y)).toBeLessThan(1)
      await expect(wc).toBeInViewport()
      await shot(page, '09-wordcount')
    })

    test('clicking a preview checkbox toggles the source', async ({ page }) => {
      await items(page).first().click()
      const editor = page.getByLabel('Markdown source')
      await editor.fill('# List\n\n- [ ] alpha\n- [x] beta\n\n```\n- [ ] not a task\n```')
      const boxes = page.getByTestId('preview').locator('input[type=checkbox]')
      await expect(boxes).toHaveCount(2)
      await boxes.nth(0).click()
      await expect(editor).toHaveValue('# List\n\n- [x] alpha\n- [x] beta\n\n```\n- [ ] not a task\n```')
      await expect(boxes.nth(0)).toBeChecked()
      await boxes.nth(1).click()
      await expect(editor).toHaveValue('# List\n\n- [x] alpha\n- [ ] beta\n\n```\n- [ ] not a task\n```')
      // Clicking the label text works too
      await page.getByTestId('preview').getByText('alpha').click()
      await expect(editor).toHaveValue(/- \[ \] alpha/)
    })

    test('search highlights matches in titles and contents', async ({ page }) => {
      await newNote(page, 'Recipes', 'Pancakes need flour and milk')
      await newNote(page, 'Travel', 'Pack the passport')
      const search = page.getByLabel('Search notes')
      await search.fill('MILK')
      await expect(items(page)).toHaveCount(1)
      await expect(items(page).first()).toContainText('Recipes')
      await expect(items(page).first().locator('mark')).toHaveText(['milk'])
      await search.fill('trav')
      await expect(items(page)).toHaveCount(1)
      await expect(items(page).first().locator('mark')).toHaveText(['Trav'])
      await search.fill('pa')
      await expect(items(page)).toHaveCount(2) // Pancakes, passport
      await shot(page, '04-search')
      await search.fill('zzz')
      await expect(page.getByText('No notes match your search.')).toBeVisible()
      await search.fill('')
      await expect(items(page)).toHaveCount(3)
    })

    test('pinning and last-edited ordering', async ({ page }) => {
      await newNote(page, 'A', 'a')
      await newNote(page, 'B', 'b')
      const titles = () => page.getByTestId('note-title').allInnerTexts()
      await expect.poll(titles).toEqual(['B', 'A', 'Welcome'])

      // Pin Welcome (oldest) → goes to top
      await items(page).nth(2).click()
      await page.getByRole('button', { name: 'Pin', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Unpin' })).toBeVisible()
      await backToList(page)
      await expect.poll(titles).toEqual(['Welcome', 'B', 'A'])
      await expect(items(page).first().getByLabel('Pinned')).toBeVisible()

      // Editing A moves it above B, still below pinned
      await items(page).nth(2).click()
      await page.getByLabel('Markdown source').fill('a edited')
      await backToList(page)
      await expect.poll(titles).toEqual(['Welcome', 'A', 'B'])
      await shot(page, '05-pinned')

      // Order survives reload
      await page.waitForTimeout(600)
      await page.reload()
      await expect.poll(titles).toEqual(['Welcome', 'A', 'B'])

      // Unpin → back into last-edited order
      await items(page).first().click()
      await page.getByRole('button', { name: 'Unpin' }).click()
      await backToList(page)
      await expect.poll(titles).toEqual(['A', 'B', 'Welcome'])
    })

    test('autosave indicator, word count and reload persistence', async ({ page }) => {
      await items(page).first().click()
      const status = page.getByTestId('save-status')
      const editor = page.getByLabel('Markdown source')
      await editor.fill('')
      await expect(page.getByTestId('word-count')).toHaveText('0 words')
      await editor.pressSequentially('Hello brave new', { delay: 20 })
      await expect(status).toHaveText('Saving…')
      await expect(status).toHaveText('✓ Saved')
      await expect(page.getByTestId('word-count')).toHaveText('3 words')
      await editor.press('End')
      await editor.pressSequentially(' world')
      await expect(page.getByTestId('word-count')).toHaveText('4 words')
      await expect(status).toHaveText('✓ Saved')
      await page.getByLabel('Note title').fill('Persisted')

      // Reload immediately (before the debounce) — the pagehide flush must save it.
      await page.reload()
      await expect(items(page).first()).toContainText('Persisted')
      await items(page).first().click()
      await expect(page.getByLabel('Markdown source')).toHaveValue('Hello brave new world')
    })

    test('theme toggle is remembered', async ({ page }) => {
      const html = page.locator('html')
      const startDark = await html.evaluate((el) => el.classList.contains('dark'))
      await page.getByRole('button', { name: /Switch to (dark|light) theme/ }).click()
      await expect(html).toHaveClass(startDark ? /^(?!.*dark)/ : /dark/)
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
      await page.reload()
      await expect(html).toHaveClass(startDark ? /^(?!.*dark)/ : /dark/)
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(bg)
      await items(page).first().click()
      await shot(page, '06-theme-toggled')
      await page.getByRole('button', { name: /Switch to (dark|light) theme/ }).click()
      await page.reload()
      await expect(html).toHaveClass(startDark ? /dark/ : /^(?!.*dark)/)
    })

    test('raw HTML in a note does not run scripts', async ({ page }) => {
      let dialogs = 0
      page.on('dialog', (d) => {
        dialogs++
        void d.dismiss()
      })
      await page.evaluate(() => ((window as unknown as { pwned: number }).pwned = 0))
      await items(page).first().click()
      await page
        .getByLabel('Markdown source')
        .fill(
          '<script>window.pwned=1;alert(1)</script>\n\n<img src=x onerror="window.pwned=2">\n\n' +
            '<svg onload="window.pwned=3"></svg>\n\n[click](javascript:window.pwned=4)\n\n<iframe src="javascript:alert(1)"></iframe>',
        )
      const preview = page.getByTestId('preview')
      await expect(preview).toContainText('<script>window.pwned=1;alert(1)</script>')
      await expect(preview.locator('script, img, svg, iframe')).toHaveCount(0)
      await expect(preview.locator('a')).toHaveCount(0)
      await preview.getByText('click', { exact: true }).click()
      await page.waitForTimeout(300)
      expect(await page.evaluate(() => (window as unknown as { pwned: number }).pwned)).toBe(0)
      expect(dialogs).toBe(0)
      await shot(page, '07-xss')
    })
  })
}
