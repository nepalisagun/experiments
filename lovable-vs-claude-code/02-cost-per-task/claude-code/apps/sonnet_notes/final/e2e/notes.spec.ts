import { expect, test, type Page } from '@playwright/test'

const sizes = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 375, height: 700 },
]

for (const size of sizes) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } })
    const mobile = size.name === 'mobile'

    const openList = async (page: Page) => {
      if (mobile && !(await page.getByLabel('Search notes').isVisible())) await page.getByLabel('Toggle note list').click()
    }
    const editor = (page: Page) => page.getByLabel('Markdown editor')
    const preview = (page: Page) => page.getByTestId('preview')
    const newNote = async (page: Page, title: string, content: string) => {
      await openList(page)
      await page.getByRole('button', { name: '+ New note' }).click()
      await page.getByLabel('Note title').fill(title)
      await editor(page).fill(content)
    }
    const titles = (page: Page) => page.getByTestId('note-title').allInnerTexts()

    test('full walkthrough', async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())
      await page.reload()
      await page.screenshot({ path: `shots/${size.name}-home.png` })

      // layout: no horizontal overflow; side-by-side vs stacked
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      const eb = (await editor(page).boundingBox())!
      const pb = (await preview(page).boundingBox())!
      if (mobile) expect(pb.y).toBeGreaterThan(eb.y + eb.height - 2)
      else expect(pb.x).toBeGreaterThan(eb.x + eb.width - 2)

      // 3: markdown features
      await newNote(page, 'Features', '# Title\n\n**bold** *ital* [lnk](https://example.com)\n\n- one\n- two\n\n1. first\n\n```\ncode here\n```\n\n- [ ] todo\n- [x] done\n')
      await expect(preview(page).locator('h1')).toHaveText('Title')
      await expect(preview(page).locator('strong')).toHaveText('bold')
      await expect(preview(page).locator('em')).toHaveText('ital')
      await expect(preview(page).locator('a')).toHaveAttribute('href', 'https://example.com')
      await expect(preview(page).locator('ul li').first()).toHaveText('one')
      await expect(preview(page).locator('ol li')).toHaveText('first')
      await expect(preview(page).locator('pre code')).toHaveText('code here')
      await expect(preview(page).locator('input[type=checkbox]')).toHaveCount(2)
      await page.screenshot({ path: `shots/${size.name}-features.png` })

      // 4: checkbox toggles source
      await preview(page).locator('input[type=checkbox]').first().click()
      await expect(editor(page)).toHaveValue(/- \[x\] todo/)
      await expect(preview(page).locator('input[type=checkbox]').first()).toBeChecked()
      await preview(page).locator('input[type=checkbox]').nth(1).click()
      await expect(editor(page)).toHaveValue(/- \[ \] done/)

      // 9: word count
      await editor(page).fill('one two three')
      await expect(page.getByTestId('word-count')).toHaveText('3 words')

      // 8: autosave indicator
      await editor(page).pressSequentially(' four')
      await expect(page.getByTestId('save-status')).toHaveText('Saving…')
      await expect(page.getByTestId('save-status')).toHaveText('Saved')

      // 11: safe HTML
      let dialogs = 0
      page.on('dialog', (d) => { dialogs++; void d.dismiss() })
      await editor(page).fill('<script>window.__x=1</script>\n<img src=x onerror="window.__x=2">\n[bad](javascript:window.__x=3)\n\n<b>raw</b>')
      await expect(preview(page)).toContainText('<script>')
      expect(await preview(page).locator('script, img, b').count()).toBe(0)
      expect(await preview(page).locator('a').count()).toBe(0)
      await page.waitForTimeout(300)
      expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined()
      expect(dialogs).toBe(0)

      // 2: rename
      await page.getByLabel('Note title').fill('Renamed')
      await openList(page)
      expect(await titles(page)).toContain('Renamed')
      if (mobile) await page.getByLabel('Toggle note list').click()
      await page.getByRole('button', { name: 'Rename', exact: true }).click()
      await expect(page.getByLabel('Note title')).toBeFocused()

      // more notes for sort/pin/search
      await newNote(page, 'Alpha', 'apples and pears')
      await newNote(page, 'Beta', 'bananas')
      await openList(page)
      // 7: newest edited first
      expect((await titles(page)).slice(0, 3)).toEqual(['Beta', 'Alpha', 'Renamed'])
      // editing an older note moves it to the top
      await page.getByTestId('note-list').getByText('Alpha').first().click()
      await editor(page).fill('apples and pears and more')
      await openList(page)
      expect((await titles(page))[0]).toBe('Alpha')

      // 6: pin
      await page.getByTestId('note-list').getByText('Renamed').first().click()
      await page.getByRole('button', { name: 'Pin', exact: true }).click()
      await openList(page)
      expect((await titles(page))[0]).toBe('Renamed')
      await expect(page.getByLabel('Pinned')).toHaveCount(1)
      await page.screenshot({ path: `shots/${size.name}-list.png` })

      // 5: search titles + contents with highlight
      await page.getByLabel('Search notes').fill('banan')
      expect(await titles(page)).toEqual(['Beta'])
      await expect(page.getByTestId('note-list').locator('mark')).toHaveText('banan')
      await page.getByLabel('Search notes').fill('alph')
      expect(await titles(page)).toEqual(['Alpha'])
      await expect(page.getByTestId('note-list').locator('mark')).toHaveText('Alph')
      await page.getByLabel('Search notes').fill('zzzz')
      await expect(page.getByText('No notes match your search.')).toBeVisible()
      await page.getByLabel('Search notes').fill('')

      // 12: reload persistence
      await editor(page).fill('persist me')
      await expect(page.getByTestId('save-status')).toHaveText('Saved')
      await page.reload()
      await openList(page)
      expect(await titles(page)).toEqual(expect.arrayContaining(['Renamed', 'Alpha', 'Beta', 'Welcome']))
      expect((await titles(page))[0]).toBe('Renamed')
      await expect(page.getByLabel('Pinned')).toHaveCount(1)

      // 10: theme toggle remembered
      if (mobile) await page.getByLabel('Toggle note list').click()
      const isDark = () => page.evaluate(() => document.documentElement.classList.contains('dark'))
      const before = await isDark()
      await page.getByLabel('Toggle theme').click()
      expect(await isDark()).toBe(!before)
      await page.screenshot({ path: `shots/${size.name}-theme.png` })
      await page.reload()
      expect(await isDark()).toBe(!before)
      await page.getByLabel('Toggle theme').click()
      expect(await isDark()).toBe(before)

      // 2: delete with confirmation
      await openList(page)
      await page.getByTestId('note-list').getByText('Beta').first().click()
      const count = (await titles(page)).length
      await page.getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(page.getByRole('alertdialog')).toBeVisible()
      await page.screenshot({ path: `shots/${size.name}-confirm.png` })
      await page.getByRole('button', { name: 'Cancel' }).click()
      await expect(page.getByRole('alertdialog')).toHaveCount(0)
      await openList(page)
      expect((await titles(page)).length).toBe(count)
      if (mobile) await page.getByLabel('Toggle note list').click()
      await page.getByRole('button', { name: 'Delete', exact: true }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
      await openList(page)
      expect(await titles(page)).not.toContain('Beta')
      expect((await titles(page)).length).toBe(count - 1)
      await page.reload()
      await openList(page)
      expect(await titles(page)).not.toContain('Beta')

      expect(errors).toEqual([])
    })
  })
}
