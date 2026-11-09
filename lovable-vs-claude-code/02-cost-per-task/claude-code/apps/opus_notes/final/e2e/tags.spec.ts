import { expect, test, type Page } from '@playwright/test'

const sizes = [
  { name: 'desktop', width: 1280, height: 800, mobile: false },
  { name: 'mobile', width: 375, height: 740, mobile: true },
] as const

for (const size of sizes) {
  test.describe(`tags – ${size.name} (${size.width}px)`, () => {
    test.use({ viewport: { width: size.width, height: size.height } })

    const list = (page: Page) => page.getByRole('list', { name: 'Note list' })
    const titles = (page: Page) => list(page).getByTestId('note-title')
    const editor = (page: Page) => page.getByLabel('Markdown editor')
    const preview = (page: Page) => page.getByTestId('preview')
    const titleInput = (page: Page) => page.getByLabel('Note title')
    const chip = (page: Page, tag: string) => page.locator(`[data-testid="tag-chip"][data-tag="${tag}"]`)
    const chips = (page: Page) => page.getByTestId('tag-chip')
    const suggestions = (page: Page) => page.getByRole('listbox', { name: 'Tag suggestions' })
    const shot = (page: Page, name: string) => page.screenshot({ path: `shots/${size.name}-tags-${name}.png` })

    async function toList(page: Page) {
      if (size.mobile && !(await list(page).isVisible())) await page.getByLabel('Back to notes').click()
      await expect(list(page)).toBeVisible()
    }
    async function newNote(page: Page, title: string, content = '') {
      await toList(page)
      await page.getByRole('button', { name: 'New', exact: true }).click()
      await titleInput(page).fill(title)
      if (content) await editor(page).fill(content)
    }
    async function open(page: Page, title: string) {
      await toList(page)
      await list(page)
        .getByTestId('note-item')
        .filter({ has: page.getByTestId('note-title').getByText(title, { exact: true }) })
        .click()
      await expect(titleInput(page)).toHaveValue(title)
    }
    /** Tag chip label → [name, count] pairs. */
    async function tagState(page: Page) {
      return chips(page).evaluateAll((els) =>
        els.map((el) => [el.getAttribute('data-tag'), el.querySelector('span:last-child')!.textContent]),
      )
    }

    test.beforeEach(async ({ page }) => {
      await page.goto('/')
    })

    test('tags in note text appear in the sidebar with note counts', async ({ page }) => {
      await toList(page)
      expect(await tagState(page)).toEqual([['welcome', '1']])

      await newNote(page, 'Plan', 'Quarterly #Work plan #ideas\n`#not-a-tag` and C# and #42')
      await newNote(page, 'Standup', 'notes #work #work')
      await toList(page)
      expect(await tagState(page)).toEqual([
        ['ideas', '1'],
        ['welcome', '1'],
        ['work', '2'],
      ])
      await shot(page, 'sidebar')

      // Counts follow edits live
      await open(page, 'Standup')
      await editor(page).fill('notes, no tags any more')
      await toList(page)
      expect(await tagState(page)).toEqual([
        ['ideas', '1'],
        ['welcome', '1'],
        ['work', '1'],
      ])

      // Tags show as chips in the preview
      await open(page, 'Plan')
      await expect(preview(page).locator('.md-tag')).toHaveText(['#Work', '#ideas'])
    })

    test('clicking a tag filters the list; clicking again clears it', async ({ page }) => {
      await newNote(page, 'A', 'alpha #red')
      await newNote(page, 'B', 'beta #blue')
      await newNote(page, 'C', 'gamma #red #blue')
      await toList(page)
      await expect(titles(page)).toHaveText(['C', 'B', 'A', 'Welcome'])

      await chip(page, 'red').click()
      await expect(chip(page, 'red')).toHaveAttribute('aria-pressed', 'true')
      await expect(titles(page)).toHaveText(['C', 'A'])
      await expect(page.getByTestId('tag-filter-bar')).toContainText('#red')
      await shot(page, 'filtered')

      // Switching to another tag
      await chip(page, 'blue').click()
      await expect(titles(page)).toHaveText(['C', 'B'])

      // Clicking the selected tag again clears the filter
      await chip(page, 'blue').click()
      await expect(chip(page, 'blue')).toHaveAttribute('aria-pressed', 'false')
      await expect(titles(page)).toHaveText(['C', 'B', 'A', 'Welcome'])
      await expect(page.getByTestId('tag-filter-bar')).toBeHidden()

      // Tag filter combines with search
      await chip(page, 'red').click()
      await page.getByLabel('Search notes').fill('gamma')
      await expect(titles(page)).toHaveText(['C'])
      await page.getByLabel('Search notes').fill('beta')
      await expect(list(page)).toContainText('No notes match “beta” tagged #red')
      await page.getByLabel('Search notes').fill('')

      // The × button clears too
      await page.getByLabel('Clear tag filter').click()
      await expect(titles(page)).toHaveCount(4)

      // Clicking a tag in the preview applies the filter
      await open(page, 'B')
      await preview(page).getByRole('button', { name: '#blue' }).click()
      await expect(list(page)).toBeVisible()
      await expect(titles(page)).toHaveText(['C', 'B'])
      await expect(chip(page, 'blue')).toHaveAttribute('aria-pressed', 'true')
    })

    test('typing # suggests existing tags; Enter or click inserts', async ({ page }) => {
      await newNote(page, 'Source', '#work #workshop #ideas #homework')
      await newNote(page, 'Target')
      const ed = editor(page)
      await ed.click()

      // Bare # lists all existing tags
      await ed.pressSequentially('Hello #')
      await expect(suggestions(page)).toBeVisible()
      await expect(suggestions(page).getByRole('option')).toHaveText([
        '#homework',
        '#ideas',
        '#welcome',
        '#work',
        '#workshop',
      ])

      // Narrowing: prefix matches first, then substring matches
      await ed.pressSequentially('wor')
      await expect(suggestions(page).getByRole('option')).toHaveText(['#work', '#workshop', '#homework'])
      await expect(suggestions(page).getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
      await shot(page, 'suggest')

      // Arrow down + Enter inserts the chosen tag and a space
      await ed.press('ArrowDown')
      await expect(suggestions(page).getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true')
      await ed.press('Enter')
      await expect(ed).toHaveValue('Hello #workshop ')
      await expect(suggestions(page)).toBeHidden()

      // Typing continues at the caret after the inserted tag
      await ed.pressSequentially('and #id')
      await expect(suggestions(page).getByRole('option')).toHaveText(['#ideas'])
      await suggestions(page).getByRole('option', { name: '#ideas' }).click()
      await expect(ed).toHaveValue('Hello #workshop and #ideas ')
      await expect(ed).toBeFocused()

      // Escape dismisses; Enter then makes a normal newline
      await ed.pressSequentially('#wo')
      await expect(suggestions(page)).toBeVisible()
      await ed.press('Escape')
      await expect(suggestions(page)).toBeHidden()
      await ed.press('Enter')
      await expect(ed).toHaveValue('Hello #workshop and #ideas #wo\n')

      // Headings and unknown tags show no suggestions
      await ed.pressSequentially('# Heading')
      await expect(suggestions(page)).toBeHidden()
      await ed.pressSequentially('\n#zzz')
      await expect(suggestions(page)).toBeHidden()

      // The new note's tags are counted
      await toList(page)
      await expect(chip(page, 'workshop').locator('span:last-child')).toHaveText('2')
      await expect(chip(page, 'zzz')).toHaveCount(1)
    })

    test('renaming a tag from the sidebar renames it in every note', async ({ page }) => {
      await newNote(page, 'One', 'Do #work today. #Work again.\n`#work` stays code. #workshop stays.')
      await newNote(page, 'Two', '- [ ] finish #work')
      await newNote(page, 'Three', 'unrelated #home')
      await toList(page)
      await chip(page, 'work').click()
      await page.getByRole('button', { name: 'Rename' }).click()
      const input = page.getByLabel('New tag name')
      await expect(input).toHaveValue('work')
      await expect(input).toBeFocused()

      // Invalid names are rejected
      await input.fill('two words')
      await page.getByRole('button', { name: 'Save' }).click()
      await expect(page.getByRole('alert')).toContainText('Use letters, numbers')
      await shot(page, 'rename-error')

      // Escape cancels
      await page.keyboard.press('Escape')
      await expect(input).toBeHidden()

      await page.getByRole('button', { name: 'Rename' }).click()
      await input.fill('#Job')
      await input.press('Enter')
      await expect(input).toBeHidden()

      // Sidebar: old tag gone, new one selected with the same notes
      await expect(chip(page, 'work')).toHaveCount(0)
      await expect(chip(page, 'job')).toHaveAttribute('aria-pressed', 'true')
      await expect(chip(page, 'job').locator('span:last-child')).toHaveText('2')
      await expect(titles(page)).toHaveText(['Two', 'One'])
      await shot(page, 'renamed')

      // Text updated in every note; code and other tags untouched
      await open(page, 'One')
      await expect(editor(page)).toHaveValue('Do #job today. #job again.\n`#work` stays code. #workshop stays.')
      await open(page, 'Two')
      await expect(editor(page)).toHaveValue('- [ ] finish #job')

      // Merge into an existing tag
      await toList(page)
      await page.getByRole('button', { name: 'Rename' }).click()
      await input.fill('home')
      await expect(page.getByText('#home already exists')).toBeVisible()
      await input.press('Enter')
      await expect(chip(page, 'home').locator('span:last-child')).toHaveText('3')
      await expect(chip(page, 'job')).toHaveCount(0)

      // Persists across reload
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem('md-notes:v1') ?? ''))
        .toContain('finish #home')
      await page.reload()
      await open(page, 'Two')
      await expect(editor(page)).toHaveValue('- [ ] finish #home')
    })
  })
}
