import { expect, test, type Page } from '@playwright/test'

const sizes = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 375, height: 700 },
]

for (const size of sizes) {
  test.describe(size.name, () => {
    const mobile = size.width < 768
    test.use({ viewport: { width: size.width, height: size.height } })

    const editor = (p: Page) => p.getByLabel('Markdown editor')
    const title = (p: Page) => p.getByLabel('Note title')
    const items = (p: Page) => p.getByTestId('note-item')

    async function open(p: Page, idx = 0) {
      await items(p).nth(idx).locator('button').first().click()
    }
    async function back(p: Page) {
      if (mobile) await p.getByRole('button', { name: '← Notes' }).click()
    }
    async function create(p: Page, name: string, body = '') {
      await p.getByRole('button', { name: '+ New' }).click()
      await title(p).fill(name)
      await editor(p).fill(body)
    }

    test.beforeEach(async ({ page }) => {
      await page.goto('/')
      await page.evaluate(() => localStorage.clear())
      await page.reload()
    })

    test('layout, screenshots, side-by-side vs stacked', async ({ page }) => {
      await page.screenshot({ path: `shots/${size.name}-list.png` })
      await open(page)
      const e = await editor(page).boundingBox()
      const pv = await page.getByTestId('preview').boundingBox()
      if (mobile) expect(pv!.y).toBeGreaterThan(e!.y + e!.height - 2)
      else expect(pv!.x).toBeGreaterThan(e!.x + e!.width - 2)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width)
      await page.screenshot({ path: `shots/${size.name}-editor.png` })
    })

    test('markdown rendering and checkbox toggling', async ({ page }) => {
      await open(page)
      await editor(page).fill('# Head\n\n**bold** *it* [lnk](https://example.com)\n\n- one\n- two\n\n```\nlet a = 1\n```\n\n- [ ] first\n- [x] second')
      const pv = page.getByTestId('preview')
      await expect(pv.locator('h1')).toHaveText('Head')
      await expect(pv.locator('strong')).toHaveText('bold')
      await expect(pv.locator('em')).toHaveText('it')
      await expect(pv.locator('a')).toHaveAttribute('href', 'https://example.com')
      await expect(pv.locator('pre code')).toContainText('let a = 1')
      await expect(pv.locator('ul li')).toHaveCount(4)
      const boxes = pv.locator('input[type=checkbox]')
      await expect(boxes).toHaveCount(2)
      await boxes.nth(0).click()
      await expect(editor(page)).toHaveValue(/- \[x\] first/)
      await expect(boxes.nth(0)).toBeChecked()
      await boxes.nth(1).click()
      await expect(editor(page)).toHaveValue(/- \[ \] second/)
      await expect(boxes.nth(1)).not.toBeChecked()
      await page.screenshot({ path: `shots/${size.name}-md.png` })
    })

    test('raw HTML does not run', async ({ page }) => {
      await open(page)
      await page.evaluate(() => ((window as any).pwned = false))
      await editor(page).fill('<script>window.pwned=true</script>\n\n<img src=x onerror="window.pwned=true">\n\n[x](javascript:window.pwned=true)')
      await page.waitForTimeout(300)
      await page.getByTestId('preview').locator('a').click({ force: true }).catch(() => {})
      expect(await page.evaluate(() => (window as any).pwned)).toBe(false)
      await expect(page.getByTestId('preview').locator('img, script')).toHaveCount(0)
      await expect(page.getByTestId('preview')).toContainText('<script>')
    })

    test('create, rename, delete with confirmation, pin, sort', async ({ page }) => {
      await create(page, 'Alpha', 'a')
      await back(page)
      await create(page, 'Beta', 'b')
      await back(page)
      await expect(items(page).first()).toContainText('Beta')
      // rename
      await open(page, 1)
      await page.getByRole('button', { name: 'Rename' }).click()
      await title(page).fill('Alpha2')
      // editing makes it newest
      await back(page)
      await expect(items(page).first()).toContainText('Alpha2')
      // pin the oldest (Beta wasn't edited since) -> goes first
      await page.getByRole('button', { name: 'Pin Beta' }).click()
      await expect(items(page).first()).toContainText('Beta')
      await expect(items(page).first()).toHaveAttribute('data-pinned', 'true')
      // delete: cancel, then confirm
      await open(page, 0)
      await page.getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(page.getByRole('dialog')).toContainText('Beta')
      await page.getByRole('button', { name: 'Cancel' }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      if (mobile) await back(page)
      await expect(items(page)).toHaveCount(3)
      await open(page, 0)
      await page.getByRole('button', { name: 'Delete', exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
      if (mobile) await expect(items(page)).toHaveCount(2)
      await expect(items(page)).toHaveCount(2)
      await expect(page.getByTestId('note-list')).not.toContainText('Beta')
      await page.screenshot({ path: `shots/${size.name}-after-delete.png` })
    })

    test('search highlights matches in title and content', async ({ page }) => {
      await create(page, 'Groceries', 'buy milk and eggs')
      await back(page)
      await create(page, 'Work', 'meeting notes')
      await back(page)
      await page.getByLabel('Search notes').fill('milk')
      await expect(items(page)).toHaveCount(1)
      await expect(items(page).locator('mark')).toHaveText('milk')
      await page.getByLabel('Search notes').fill('GROC')
      await expect(items(page)).toHaveCount(1)
      await expect(items(page).locator('mark')).toHaveText('Groc')
      await page.getByLabel('Search notes').fill('zzz')
      await expect(page.getByText('No notes match')).toBeVisible()
      await page.screenshot({ path: `shots/${size.name}-search.png` })
    })

    test('autosave indicator, word count, reload persistence', async ({ page }) => {
      await create(page, 'Persist me', 'one two three')
      await expect(page.getByTestId('word-count')).toHaveText('3 words')
      await editor(page).fill('one two three four five')
      await expect(page.getByTestId('save-status')).toHaveText('Saving…')
      await expect(page.getByTestId('save-status')).toHaveText('Saved')
      await expect(page.getByTestId('word-count')).toHaveText('5 words')
      await page.reload()
      await expect(items(page).first()).toContainText('Persist me')
      await open(page)
      await expect(editor(page)).toHaveValue('one two three four five')
    })

    test('typing then immediate reload does not lose data', async ({ page }) => {
      await create(page, 'Quick', 'x')
      await editor(page).fill('quick reload text')
      await page.reload()
      await open(page)
      await expect(editor(page)).toHaveValue('quick reload text')
    })

    test('empty-state text and word count at bottom right', async ({ page }) => {
      await open(page)
      const wc = await page.getByTestId('word-count').boundingBox()
      const ed = await page.locator('main').boundingBox()
      expect(wc!.x + wc!.width).toBeGreaterThan(ed!.x + ed!.width - 24)
      expect(wc!.y + wc!.height).toBeGreaterThan(ed!.y + ed!.height - 20)
      await page.screenshot({ path: `shots/${size.name}-wordcount.png` })
      await page.getByRole('button', { name: 'Delete', exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
      await expect(page.getByTestId('note-list')).toHaveText('Nothing here yet. Create your first note.')
      await page.screenshot({ path: `shots/${size.name}-empty.png` })
    })

    test('theme toggle is remembered', async ({ page }) => {
      const html = page.locator('html')
      const before = await html.getAttribute('class')
      await page.getByTestId('theme-toggle').click()
      const dark = (await html.getAttribute('class'))?.includes('dark')
      expect(dark).toBe(!before?.includes('dark'))
      await page.screenshot({ path: `shots/${size.name}-theme.png` })
      await page.reload()
      expect(((await html.getAttribute('class')) ?? '').includes('dark')).toBe(!!dark)
    })
  })
}
