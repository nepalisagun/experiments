import { expect, test } from '@playwright/test'

for (const [name, width, height] of [['desktop', 1280, 800], ['mobile', 375, 700]] as const) {
  test(`${name}: word count bottom-right of editor, new empty-state text`, async ({ page }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width, height })
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()

    const editor = page.getByLabel('Markdown editor')
    const count = page.getByTestId('word-count')
    await editor.fill('one two three')
    await expect(count).toHaveText('3 words')
    const e = (await editor.boundingBox())!
    const c = (await count.boundingBox())!
    // inside the editor, in its bottom-right corner
    expect(c.x + c.width).toBeLessThanOrEqual(e.x + e.width)
    expect(c.y + c.height).toBeLessThanOrEqual(e.y + e.height)
    expect(c.x).toBeGreaterThan(e.x + e.width / 2)
    expect(c.y).toBeGreaterThan(e.y + e.height - 60)
    // not in the old status bar
    await expect(page.getByTestId('save-status')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: `shots/${name}-wordcount.png` })

    // long text: count stays pinned bottom-right while editor scrolls
    await editor.fill(Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n'))
    const c2 = (await count.boundingBox())!
    expect(c2.y).toBeGreaterThan(e.y + e.height - 60)

    // delete every note -> empty state text
    if (name === 'mobile') await page.getByLabel('Toggle note list').click()
    const list = page.getByTestId('note-list')
    while ((await list.getByTestId('note-title').count()) > 0) {
      if (name === 'mobile' && (await page.getByLabel('Search notes').isVisible())) await page.getByLabel('Toggle note list').click()
      await page.getByRole('button', { name: 'Delete', exact: true }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
      if (name === 'mobile') await page.getByLabel('Toggle note list').click()
    }
    await expect(list.getByText('Nothing here yet. Create your first note.')).toBeVisible()
    await expect(page.getByText('No notes yet.')).toHaveCount(0)
    await page.screenshot({ path: `shots/${name}-empty.png` })

    // search with no hits keeps its own message
    await page.getByRole('button', { name: '+ New note' }).first().click()
    if (name === 'mobile') await page.getByLabel('Toggle note list').click()
    await page.getByLabel('Search notes').fill('zzz')
    await expect(page.getByText('No notes match your search.')).toBeVisible()
  })
}
