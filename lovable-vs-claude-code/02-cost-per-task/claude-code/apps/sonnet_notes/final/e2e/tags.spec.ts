import { expect, test, type Page } from '@playwright/test'

for (const [name, width, height] of [['desktop', 1280, 800], ['mobile', 375, 700]] as const) {
  test.describe(name, () => {
    test.use({ viewport: { width, height } })
    const mobile = name === 'mobile'

    const openList = async (page: Page) => {
      if (mobile && !(await page.getByLabel('Search notes').isVisible())) await page.getByLabel('Toggle note list').click()
    }
    const editor = (page: Page) => page.getByLabel('Markdown editor')
    const titles = (page: Page) => page.getByTestId('note-title').allInnerTexts()
    const tagChips = (page: Page) => page.getByTestId('tag-list').locator('[aria-pressed]')
    const chip = (page: Page, text: string) => page.getByTestId('tag-list').getByRole('button', { name: text, exact: true })
    const newNote = async (page: Page, title: string, content: string) => {
      await openList(page)
      await page.getByRole('button', { name: '+ New note' }).click()
      await page.getByLabel('Note title').fill(title)
      await editor(page).fill(content)
    }
    const selectNote = async (page: Page, title: string) => {
      await openList(page)
      await page.getByTestId('note-list').getByText(title, { exact: true }).click()
    }

    test('tags end to end', async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())
      await page.reload()

      // no tags yet -> no tag section (Welcome has only headings)
      await openList(page)
      await expect(page.getByTestId('tag-list')).toHaveCount(0)

      // 1: tags come from note text; counts are per note, case-insensitive
      await newNote(page, 'Alpha', 'plan #work and #home')
      await newNote(page, 'Beta', '#work stuff #Work\n\n# Heading is not a tag')
      await newNote(page, 'Gamma', 'nothing here')
      await openList(page)
      await expect(tagChips(page)).toHaveCount(2)
      await expect(chip(page, '#home 1')).toBeVisible()
      await expect(chip(page, '#work 2')).toBeVisible()
      expect(await tagChips(page).allInnerTexts()).toEqual(['#home 1', '#work 2']) // sorted, no "#heading"
      await page.screenshot({ path: `shots/${name}-tags.png` })

      // 2: click filters, click again clears
      await chip(page, '#work 2').click()
      await expect(chip(page, '#work 2')).toHaveAttribute('aria-pressed', 'true')
      expect((await titles(page)).sort()).toEqual(['Alpha', 'Beta'])
      await page.screenshot({ path: `shots/${name}-tag-filter.png` })
      await chip(page, '#work 2').click()
      await expect(chip(page, '#work 2')).toHaveAttribute('aria-pressed', 'false')
      expect(await titles(page)).toHaveLength(4)
      // switching directly between tags
      await chip(page, '#home 1').click()
      expect(await titles(page)).toEqual(['Alpha'])
      await chip(page, '#work 2').click()
      expect((await titles(page)).sort()).toEqual(['Alpha', 'Beta'])
      // combines with search
      await page.getByLabel('Search notes').fill('stuff')
      expect(await titles(page)).toEqual(['Beta'])
      await page.getByLabel('Search notes').fill('')
      await chip(page, '#work 2').click()

      // 3: suggestions while typing '#'
      await selectNote(page, 'Gamma')
      await editor(page).click()
      await editor(page).press('Control+End')
      await editor(page).pressSequentially(' #wo')
      const listbox = page.getByRole('listbox', { name: 'Tag suggestions' })
      await expect(listbox).toBeVisible()
      await expect(listbox.getByRole('option')).toHaveText(['#work'])
      await page.screenshot({ path: `shots/${name}-suggest.png` })
      await editor(page).press('Enter') // insert with Enter
      await expect(editor(page)).toHaveValue('nothing here #work ')
      await expect(listbox).toHaveCount(0)
      // caret is after the inserted tag: typing continues there
      await editor(page).pressSequentially('more')
      await expect(editor(page)).toHaveValue('nothing here #work more')

      // insert with a click
      await editor(page).pressSequentially(' #h')
      await expect(listbox.getByRole('option')).toHaveText(['#home'])
      await listbox.getByRole('option', { name: '#home' }).click()
      await expect(editor(page)).toHaveValue('nothing here #work more #home ')
      await expect(editor(page)).toBeFocused()
      // bare '#' lists all, arrows move, Escape closes
      await editor(page).pressSequentially('#')
      await expect(listbox.getByRole('option')).toHaveText(['#home', '#work'])
      await editor(page).press('ArrowDown')
      await expect(listbox.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true')
      await editor(page).press('Escape')
      await expect(listbox).toHaveCount(0)
      // Enter with no popup is a normal newline
      await editor(page).press('Enter')
      await expect(editor(page)).toHaveValue('nothing here #work more #home #\n')
      // no suggestions for headings or code
      await editor(page).fill('# ')
      await expect(listbox).toHaveCount(0)
      await editor(page).fill('`#wo')
      await expect(listbox).toHaveCount(0)
      // ArrowDown + Enter picks the second
      await editor(page).fill('#')
      await editor(page).press('ArrowDown')
      await editor(page).press('Enter')
      await expect(editor(page)).toHaveValue('#work ')
      await editor(page).fill('see #work and #home')

      await openList(page)
      await expect(chip(page, '#work 3')).toBeVisible()
      await expect(chip(page, '#home 2')).toBeVisible()

      // 4: rename a tag from the sidebar -> every note's text changes
      await chip(page, '#work 3').click() // active filter should follow the rename
      await page.getByRole('button', { name: 'Rename tag work' }).click()
      const input = page.getByLabel('New name for tag work')
      await expect(input).toBeFocused()
      await input.fill('bad name!')
      await input.press('Enter')
      await expect(page.getByRole('alert')).toBeVisible()
      await input.fill('#Job')
      await page.screenshot({ path: `shots/${name}-tag-rename.png` })
      await input.press('Enter')
      await expect(page.getByLabel('New name for tag work')).toHaveCount(0)
      await expect(chip(page, '#job 3')).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByTestId('tag-list').getByText('#work')).toHaveCount(0)
      expect((await titles(page)).sort()).toEqual(['Alpha', 'Beta', 'Gamma'])
      await selectNote(page, 'Alpha')
      await expect(editor(page)).toHaveValue('plan #job and #home')
      await selectNote(page, 'Beta')
      await expect(editor(page)).toHaveValue('#job stuff #job\n\n# Heading is not a tag')
      await selectNote(page, 'Gamma')
      await expect(editor(page)).toHaveValue('see #job and #home')

      // rename cancel via Escape leaves things alone
      await openList(page)
      await page.getByRole('button', { name: 'Rename tag home' }).click()
      await page.getByLabel('New name for tag home').press('Escape')
      await expect(chip(page, '#home 2')).toBeVisible()

      // renamed tag survives a reload
      await expect(page.getByTestId('save-status')).toHaveText('Saved')
      await page.reload()
      await openList(page)
      await expect(chip(page, '#job 3')).toBeVisible()
      await expect(chip(page, '#home 2')).toBeVisible()
      await chip(page, '#home 2').click()
      expect((await titles(page)).sort()).toEqual(['Alpha', 'Gamma'])

      // deleting the only notes of a tag drops it and clears the filter
      await chip(page, '#home 2').click()
      for (const t of ['Alpha', 'Gamma']) {
        await selectNote(page, t)
        if (mobile) { /* drawer closed by selecting */ }
        await page.getByRole('button', { name: 'Delete', exact: true }).click()
        await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
      }
      await openList(page)
      await expect(page.getByTestId('tag-list').getByText('#home')).toHaveCount(0)
      await expect(chip(page, '#job 1')).toBeVisible()

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      expect(errors).toEqual([])
    })
  })
}
