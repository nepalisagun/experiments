import { expect, test, type Page } from '@playwright/test'

const sizes = [
  { name: 'desktop', width: 1280, height: 800, mobile: false },
  { name: 'mobile', width: 375, height: 740, mobile: true },
] as const

for (const size of sizes) {
  test.describe(`${size.name} (${size.width}px)`, () => {
    test.use({ viewport: { width: size.width, height: size.height } })

    const list = (page: Page) => page.getByRole('list', { name: 'Note list' })
    const items = (page: Page) => list(page).getByTestId('note-item')
    const titles = (page: Page) => list(page).getByTestId('note-title')
    const editor = (page: Page) => page.getByLabel('Markdown editor')
    const preview = (page: Page) => page.getByTestId('preview')
    const titleInput = (page: Page) => page.getByLabel('Note title')
    const shot = (page: Page, name: string) => page.screenshot({ path: `shots/${size.name}-${name}.png` })

    /** On mobile only one pane is visible at a time. */
    async function toList(page: Page) {
      if (size.mobile && !(await list(page).isVisible())) await page.getByLabel('Back to notes').click()
      await expect(list(page)).toBeVisible()
    }
    async function newNote(page: Page, title: string, content = '') {
      await toList(page)
      await page.getByRole('button', { name: 'New', exact: true }).click()
      await expect(titleInput(page)).toBeFocused()
      await titleInput(page).fill(title)
      if (content) await editor(page).fill(content)
    }
    async function open(page: Page, title: string) {
      await toList(page)
      await items(page)
        .filter({ has: page.getByTestId('note-title').getByText(title, { exact: true }) })
        .click()
      await expect(titleInput(page)).toHaveValue(title)
    }

    test.beforeEach(async ({ page }) => {
      await page.goto('/')
    })

    test('1. sidebar list and editor layout, welcome note seeded', async ({ page }) => {
      await expect(titles(page)).toHaveText(['Welcome'])
      if (size.mobile) {
        // List first, editor after tapping a note.
        await expect(editor(page)).toBeHidden()
        await shot(page, '01-list')
        await items(page).first().click()
        await expect(list(page)).toBeHidden()
        await expect(editor(page)).toBeVisible()
        // Editor stacked above preview.
        const e = (await editor(page).boundingBox())!
        const p = (await preview(page).boundingBox())!
        expect(p.y).toBeGreaterThanOrEqual(e.y + e.height - 1)
        expect(Math.abs(p.x - e.x)).toBeLessThan(2)
      } else {
        await expect(list(page)).toBeVisible()
        await expect(editor(page)).toBeVisible()
        // Sidebar | editor | preview side by side.
        const l = (await list(page).boundingBox())!
        const e = (await editor(page).boundingBox())!
        const p = (await preview(page).boundingBox())!
        expect(e.x).toBeGreaterThanOrEqual(l.x + l.width - 1)
        expect(p.x).toBeGreaterThanOrEqual(e.x + e.width - 1)
        expect(Math.abs(p.y - e.y)).toBeLessThan(5)
      }
      // No horizontal page scroll.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow).toBeLessThanOrEqual(0)
      // Nothing edited yet: indicator must not claim to be saving.
      await page.waitForTimeout(600)
      await expect(page.getByTestId('save-status')).toHaveText('Saved')
      // List preview is plain text, not raw Markdown.
      await toList(page)
      await expect(list(page)).toContainText('Welcome to Notes Write Markdown in the editor')
      if (size.mobile) await items(page).first().click()
      await shot(page, '01-editor')
    })

    test('2. create, rename and delete with confirmation', async ({ page }) => {
      await newNote(page, 'First draft', 'hello')
      await toList(page)
      await expect(titles(page).first()).toHaveText('First draft')

      // Rename
      await open(page, 'First draft')
      await titleInput(page).fill('Final copy')
      await toList(page)
      await expect(titles(page)).toContainText(['Final copy'])
      await expect(titles(page)).not.toContainText(['First draft'])

      // Delete: cancel keeps the note
      await open(page, 'Final copy')
      await page.getByLabel('Delete note').click()
      const dialog = page.getByRole('alertdialog')
      await expect(dialog).toContainText('Final copy')
      await shot(page, '02-confirm')
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toBeHidden()
      await expect(titleInput(page)).toHaveValue('Final copy')

      // Escape also cancels
      await page.getByLabel('Delete note').click()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()

      // Confirm deletes
      await page.getByLabel('Delete note').click()
      await dialog.getByRole('button', { name: 'Delete' }).click()
      await expect(dialog).toBeHidden()
      await toList(page)
      await expect(titles(page)).toHaveText(['Welcome'])

      // Deleting the last note shows an empty state
      await open(page, 'Welcome')
      await page.getByLabel('Delete note').click()
      await dialog.getByRole('button', { name: 'Delete' }).click()
      await toList(page)
      await expect(list(page)).toContainText('Nothing here yet. Create your first note.')
      await shot(page, '02-empty')
    })

    test('3. live preview renders Markdown', async ({ page }) => {
      await newNote(
        page,
        'Syntax',
        [
          '# Heading One',
          '## Heading Two',
          'Some **bold** and *italic* text.',
          '',
          '- bullet a',
          '- bullet b',
          '',
          '1. first',
          '2. second',
          '',
          '[Example](https://example.com)',
          '',
          '```',
          'const x = 1',
          '```',
          '',
          '- [ ] open task',
          '- [x] done task',
        ].join('\n'),
      )
      const p = preview(page)
      await expect(p.locator('h1')).toHaveText('Heading One')
      await expect(p.locator('h2')).toHaveText('Heading Two')
      await expect(p.locator('strong')).toHaveText('bold')
      await expect(p.locator('em')).toHaveText('italic')
      await expect(p.locator('ul:not(.task-list) > li')).toHaveText(['bullet a', 'bullet b'])
      await expect(p.locator('ol > li')).toHaveText(['first', 'second'])
      await expect(p.locator('a')).toHaveAttribute('href', 'https://example.com')
      await expect(p.locator('pre code')).toHaveText('const x = 1')
      await expect(p.locator('input[type=checkbox]')).toHaveCount(2)
      await expect(p.locator('input[type=checkbox]').nth(1)).toBeChecked()

      // Live: typing updates the preview immediately
      await editor(page).press('ControlOrMeta+End')
      await editor(page).pressSequentially('\n\n### Live')
      await expect(p.locator('h3')).toHaveText('Live')
      await p.locator('pre').scrollIntoViewIfNeeded()
      await shot(page, '03-preview')
    })

    test('4. clicking a preview checkbox toggles the source', async ({ page }) => {
      await newNote(page, 'Tasks', 'Intro\n\n- [ ] alpha\n- [x] beta\n  - [ ] nested')
      const boxes = preview(page).locator('input[type=checkbox]')
      await boxes.nth(0).click()
      await expect(editor(page)).toHaveValue('Intro\n\n- [x] alpha\n- [x] beta\n  - [ ] nested')
      await expect(boxes.nth(0)).toBeChecked()
      await boxes.nth(1).click()
      await expect(editor(page)).toHaveValue('Intro\n\n- [x] alpha\n- [ ] beta\n  - [ ] nested')
      await expect(boxes.nth(1)).not.toBeChecked()
      // Clicking the label text works too
      await preview(page).getByText('nested').click()
      await expect(editor(page)).toHaveValue('Intro\n\n- [x] alpha\n- [ ] beta\n  - [x] nested')
      await shot(page, '04-tasks')
    })

    test('5. search across titles and contents with highlighting', async ({ page }) => {
      await newNote(page, 'Shopping', 'buy oat milk')
      await newNote(page, 'Recipes', 'pancakes need Milk and eggs')
      await newNote(page, 'Milkshake ideas', 'vanilla')
      await toList(page)
      await page.getByLabel('Search notes').fill('milk')
      await expect(titles(page)).toHaveText(['Milkshake ideas', 'Recipes', 'Shopping'])
      const marks = list(page).locator('mark')
      await expect(marks.first()).toBeVisible()
      // title match + 2 content matches
      await expect(marks).toHaveText(['Milk', 'Milk', 'milk'])
      await shot(page, '05-search')

      await page.getByLabel('Search notes').fill('pancakes')
      await expect(titles(page)).toHaveText(['Recipes'])
      await expect(marks).toHaveText(['pancakes'])

      await page.getByLabel('Search notes').fill('nothing-matches')
      await expect(items(page)).toHaveCount(0)
      await expect(list(page)).toContainText('No notes match')

      await page.getByLabel('Search notes').fill('')
      await expect(items(page)).toHaveCount(4)
      await expect(marks).toHaveCount(0)
    })

    test('6 & 7. pinned notes first, then newest edited first', async ({ page }) => {
      await newNote(page, 'A', 'a')
      await newNote(page, 'B', 'b')
      await newNote(page, 'C', 'c')
      await toList(page)
      await expect(titles(page)).toHaveText(['C', 'B', 'A', 'Welcome'])

      // Editing A moves it to the top
      await open(page, 'A')
      await editor(page).fill('a edited')
      await toList(page)
      await expect(titles(page)).toHaveText(['A', 'C', 'B', 'Welcome'])

      // Pin Welcome (oldest) from the list
      await page.getByLabel('Pin Welcome').click()
      await expect(titles(page)).toHaveText(['Welcome', 'A', 'C', 'B'])

      // Pin B from the editor header
      await open(page, 'B')
      await page.getByLabel('Pin note').click()
      await expect(page.getByLabel('Unpin note')).toBeVisible()
      await toList(page)
      // Pinning does not count as an edit: pinned group still sorted by last edit
      // (B was created after Welcome, so it comes first among the pinned notes)
      await expect(titles(page)).toHaveText(['B', 'Welcome', 'A', 'C'])
      await shot(page, '06-pinned')

      // Editing an unpinned note never jumps above pinned ones
      await open(page, 'C')
      await editor(page).fill('c edited')
      await toList(page)
      await expect(titles(page)).toHaveText(['B', 'Welcome', 'C', 'A'])

      // Unpin
      await page.getByLabel('Unpin Welcome').click()
      await expect(titles(page)).toHaveText(['B', 'C', 'A', 'Welcome'])

      // Pins survive reload
      await page.reload()
      await expect(titles(page)).toHaveText(['B', 'C', 'A', 'Welcome'])
    })

    test('8. autosave with Saved indicator', async ({ page }) => {
      await newNote(page, 'Autosave')
      const status = page.getByTestId('save-status')
      await expect(status).toHaveText('Saved')
      await editor(page).pressSequentially('typing quickly', { delay: 20 })
      await expect(status).toHaveText('Saving…')
      await expect(status).toHaveText('Saved')
      const stored = await page.evaluate(() => localStorage.getItem('md-notes:v1'))
      expect(stored).toContain('typing quickly')
      await shot(page, '08-saved')
    })

    test('9. word count for the open note', async ({ page }) => {
      await newNote(page, 'Count')
      const wc = page.getByTestId('word-count')
      await expect(wc).toHaveText('0 words')
      await editor(page).fill('# Hello **world**')
      await expect(wc).toHaveText('2 words')
      await editor(page).fill('one')
      await expect(wc).toHaveText('1 word')
      await editor(page).fill('- [ ] buy milk\n- [x] call [Mom](https://example.com/x)')
      await expect(wc).toHaveText('4 words')

      // Positioned at the bottom right of the editor pane.
      const e = (await editor(page).boundingBox())!
      const w = (await wc.boundingBox())!
      expect(w.y).toBeGreaterThanOrEqual(e.y + e.height - 1)
      expect(w.y - (e.y + e.height)).toBeLessThan(20)
      expect(Math.abs(e.x + e.width - (w.x + w.width))).toBeLessThan(24)
      await expect(page.locator('header').getByTestId('word-count')).toHaveCount(0)
      await shot(page, '09-wordcount')
    })

    test('10. theme toggle is remembered', async ({ page }) => {
      const html = page.locator('html')
      await toList(page)
      await expect(html).not.toHaveClass(/dark/)
      await page.getByLabel('Switch to dark theme').click()
      await expect(html).toHaveClass(/dark/)
      const bg = await page.evaluate(() => getComputedStyle(document.body.firstElementChild!.firstElementChild!).backgroundColor)
      expect(bg).not.toBe('rgb(255, 255, 255)')
      await page.reload()
      await expect(html).toHaveClass(/dark/)
      if (size.mobile) await items(page).first().click()
      await shot(page, '10-dark')
      await toList(page)
      await page.getByLabel('Switch to light theme').click()
      await expect(html).not.toHaveClass(/dark/)
      await page.reload()
      await expect(html).not.toHaveClass(/dark/)
    })

    test('11. raw HTML in a note cannot run scripts', async ({ page }) => {
      const dialogs: string[] = []
      page.on('dialog', (d) => {
        dialogs.push(d.message())
        void d.dismiss()
      })
      await newNote(
        page,
        'XSS',
        [
          '<script>window.__xss = 1</script>',
          '<img src=x onerror="window.__xss = 2">',
          '<svg onload="window.__xss = 3"></svg>',
          '<iframe src="javascript:window.__xss=4"></iframe>',
          '[click me](javascript:window.__xss=5)',
          '- [ ] <img src=x onerror="window.__xss = 6">',
          '<a href="#" onclick="window.__xss=7">raw link</a>',
        ].join('\n\n'),
      )
      const p = preview(page)
      await expect(p).toContainText('<script>window.__xss = 1</script>')
      await expect(p.locator('script, img, svg, iframe, [onclick], [onerror], [onload]')).toHaveCount(0)
      await p.getByText('click me').click()
      await p.getByText('raw link', { exact: false }).click()
      await page.waitForTimeout(300)
      expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
      expect(dialogs).toEqual([])
      // Still safe after reload (rendered from storage)
      await page.reload()
      await open(page, 'XSS')
      await expect(preview(page).locator('script, img, svg, iframe')).toHaveCount(0)
      expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
      await shot(page, '11-xss')
    })

    test('12. notes survive a page reload', async ({ page }) => {
      await newNote(page, 'Persistent', '# Kept\n\n- [ ] item')
      await preview(page).locator('input[type=checkbox]').click()
      await expect(page.getByTestId('save-status')).toHaveText('Saved')
      await page.reload()
      await toList(page)
      await expect(titles(page)).toHaveText(['Persistent', 'Welcome'])
      await open(page, 'Persistent')
      await expect(editor(page)).toHaveValue('# Kept\n\n- [x] item')

      // Typing then reloading immediately (before the debounce fires) still saves
      await editor(page).press('ControlOrMeta+End')
      await editor(page).pressSequentially(' fast')
      await page.reload()
      await open(page, 'Persistent')
      await expect(editor(page)).toHaveValue('# Kept\n\n- [x] item fast')

      // Deleted notes stay deleted
      await page.getByLabel('Delete note').click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
      await page.reload()
      await toList(page)
      await expect(titles(page)).toHaveText(['Welcome'])
    })
  })
}
