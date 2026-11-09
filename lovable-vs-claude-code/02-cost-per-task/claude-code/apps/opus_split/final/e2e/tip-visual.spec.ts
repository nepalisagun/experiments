import { expect, test } from '@playwright/test'

// Visual check of the tip row (default 18% preset) at desktop and mobile widths.
for (const size of [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 375, height: 812 },
]) {
  test(`tip row renders cleanly on ${size.name}`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height })
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    const group = page.getByRole('group', { name: 'Tip (%)' })
    await expect(group.getByRole('button')).toHaveText(['10%', '15%', '18%', '20%'])
    await expect(group.getByRole('button', { name: '18%' })).toHaveAttribute('aria-pressed', 'true')

    // Every control in the row is fully inside the card and the custom placeholder isn't clipped.
    const custom = page.getByLabel('Custom tip percentage')
    const fits = await custom.evaluate((el: HTMLInputElement) => {
      const ctx = document.createElement('canvas').getContext('2d')!
      ctx.font = getComputedStyle(el).font
      return ctx.measureText(el.placeholder).width <= el.clientWidth - 24
    })
    expect(fits).toBe(true)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)

    await page.waitForTimeout(400) // let the button color transition settle
    await page.locator('section', { has: page.getByRole('heading', { name: 'Tax & tip' }) }).screenshot({
      path: `shots/${size.name}-tip-row.png`,
    })
  })
}
