import { test } from '@playwright/test'
test.use({ viewport: { width: 375, height: 740 } })
test('probe', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByTestId('note-item').first().click()
  await page.getByLabel('Markdown source').fill('<script>x</script>\n\nhello\n\n[click](javascript:1)')
  await page.screenshot({ path: 'shots/probe-a.png' })
  await page.getByTestId('preview').getByText('click', { exact: true }).click()
  await page.screenshot({ path: 'shots/probe-b.png' })
  const info = await page.evaluate(() => {
    const p = document.querySelector('[data-testid=preview]')!
    const g = p.parentElement!
    return { gridScroll: g.scrollTop, gridH: g.clientHeight, gridSH: g.scrollHeight, pTop: p.getBoundingClientRect().top, first: p.firstElementChild?.getBoundingClientRect().top }
  })
  console.log('INFO ' + JSON.stringify(info))
})
