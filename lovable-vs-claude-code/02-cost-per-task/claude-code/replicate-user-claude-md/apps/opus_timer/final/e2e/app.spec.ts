import { expect, test, type Page } from '@playwright/test'

const countdown = (p: Page) => p.getByTestId('countdown')
const startBtn = (p: Page) => p.getByRole('button', { name: /^(Start|Pause|Resume)$/ })

async function setDurations(page: Page, focus: string, short: string, long: string) {
  await page.getByRole('button', { name: 'Settings' }).click()
  const d = page.getByRole('dialog')
  await d.getByLabel('Focus', { exact: true }).fill(focus)
  await d.getByLabel('Short break').fill(short)
  await d.getByLabel('Recharge').fill(long)
  await d.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-09T09:00:00') })
  await page.goto('/')
  await expect(page).toHaveTitle(/ - /) // effects have run, listeners are attached
})

test('defaults, big countdown, tab title, no horizontal scroll', async ({ page }, info) => {
  await expect(countdown(page)).toHaveText('25:00')
  await expect(page.getByTestId('phase')).toHaveText('Focus')
  await expect(page).toHaveTitle('25:00 - Focus')
  const box = await countdown(page).boundingBox()
  expect(box!.height).toBeGreaterThan(50)
  await expect(page.getByTestId('dots')).toContainText('0 of 4 until Recharge')
  const fontPx = await countdown(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  expect(fontPx).toBe(info.project.name === 'mobile' ? 92 : 80) // mobile was 72px before
  // The widest reading ("00:00" style digits) must stay inside the ring.
  const ring = await page.getByTestId('ring').boundingBox()
  await page.evaluate(() => { document.querySelector('[data-testid=countdown]')!.textContent = '00:00' })
  const wide = await countdown(page).boundingBox()
  expect(wide!.x).toBeGreaterThan(ring!.x + 8)
  expect(wide!.x + wide!.width).toBeLessThan(ring!.x + ring!.width - 8)
  await page.reload()
  await expect(countdown(page)).toHaveText('25:00')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await page.screenshot({ path: `shots/${info.project.name}-home.png`, fullPage: true })
})

test('start, pause, resume, reset; title tracks remaining time', async ({ page }) => {
  await startBtn(page).click()
  await expect(startBtn(page)).toHaveText('Pause')
  await page.clock.runFor(12 * 60_000 + 56_000)
  await expect(countdown(page)).toHaveText('12:04')
  await expect(page).toHaveTitle('12:04 - Focus')
  await startBtn(page).click()
  await expect(startBtn(page)).toHaveText('Resume')
  await page.clock.runFor(5 * 60_000)
  await expect(countdown(page)).toHaveText('12:04') // paused stays put
  await startBtn(page).click()
  await page.clock.runFor(4_000)
  await expect(countdown(page)).toHaveText('12:00')
  await page.getByRole('button', { name: 'Reset' }).click()
  await expect(countdown(page)).toHaveText('25:00')
  await expect(startBtn(page)).toHaveText('Start')
})

test('space bar starts and pauses, also with a button focused, but not while typing', async ({ page }) => {
  await page.keyboard.press('Space')
  await expect(startBtn(page)).toHaveText('Pause')
  await page.keyboard.press('Space')
  await expect(startBtn(page)).toHaveText('Resume')
  // A focused button must not be "clicked" by the same keypress (that would toggle twice).
  await page.getByRole('button', { name: 'Reset' }).focus()
  await page.keyboard.press('Space')
  await expect(startBtn(page)).toHaveText('Pause')
  await expect(countdown(page)).not.toHaveText('25:00')
  await page.getByLabel('Working on').fill('Write report')
  await page.getByLabel('Working on').press('Space')
  await expect(startBtn(page)).toHaveText('Pause')
  await expect(page.getByLabel('Working on')).toHaveValue('Write report ')
})

test('skip moves through phases without logging', async ({ page }) => {
  await page.getByRole('button', { name: 'Skip' }).click()
  await expect(page.getByTestId('phase')).toHaveText('Short break')
  await expect(countdown(page)).toHaveText('05:00')
  await expect(page).toHaveTitle('05:00 - Short break')
  await page.getByRole('button', { name: 'Skip' }).click()
  await expect(page.getByTestId('phase')).toHaveText('Focus')
  await expect(page.getByTestId('log-summary')).toHaveText('0 sessions · 0 min')
})

test('full cycle: 4 focus sessions → Recharge, dots, log with labels and finish times, chime', async ({ page }, info) => {
  await setDurations(page, '1', '1', '2')
  await expect(countdown(page)).toHaveText('01:00')
  const dots = page.getByTestId('dots')
  for (let i = 1; i <= 4; i++) {
    await page.getByLabel('Working on').fill(`Task ${i}`)
    await startBtn(page).click()
    await page.clock.runFor(60_000)
    await expect(dots).toHaveAttribute('aria-label', `${i} of 4 focus sessions before Recharge`)
    await expect(dots.locator('[data-filled="true"]')).toHaveCount(i)
    if (i < 4) {
      await expect(page.getByTestId('phase')).toHaveText('Short break')
      await expect(page).toHaveTitle('01:00 - Short break')
      if (i === 2) await page.screenshot({ path: `shots/${info.project.name}-break.png`, fullPage: true })
      await startBtn(page).click()
      await page.clock.runFor(60_000)
      await expect(page.getByTestId('phase')).toHaveText('Focus')
    }
  }
  await expect(page.getByTestId('phase')).toHaveText('Recharge')
  await expect(countdown(page)).toHaveText('02:00')
  await expect(page).toHaveTitle('02:00 - Recharge')
  await expect(dots).toContainText('Recharge earned')
  await page.getByRole('button', { name: 'Settings' }).click()
  const html = await page.evaluate(() => document.body.innerHTML + document.title)
  expect(html).not.toMatch(/long break/i)
  await page.keyboard.press('Escape')
  const items = page.getByTestId('log').locator('li')
  await expect(items).toHaveCount(4)
  await expect(items.first()).toContainText('Task 4') // newest first
  await expect(items.last()).toContainText('Task 1')
  await expect(items.last()).toContainText('09:01') // finished one minute after 09:00
  await expect(page.getByTestId('log-summary')).toHaveText('4 sessions · 4 min')
  expect(await page.evaluate(() => (window as unknown as { __chimes: number }).__chimes)).toBe(7)
  await page.screenshot({ path: `shots/${info.project.name}-long.png`, fullPage: true })

  await startBtn(page).click()
  await page.clock.runFor(2 * 60_000)
  await expect(page.getByTestId('phase')).toHaveText('Focus')
  await expect(dots.locator('[data-filled="true"]')).toHaveCount(0)
})

test('mute toggle silences the chime and persists', async ({ page }) => {
  await setDurations(page, '1', '1', '1')
  await page.getByRole('button', { name: 'Mute sound' }).click()
  await expect(page.getByRole('button', { name: 'Unmute sound' })).toHaveAttribute('aria-pressed', 'true')
  await startBtn(page).click()
  await page.clock.runFor(60_000)
  await expect(page.getByTestId('phase')).toHaveText('Short break')
  expect(await page.evaluate(() => (window as unknown as { __chimes?: number }).__chimes ?? 0)).toBe(0)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Unmute sound' })).toBeVisible()
  await page.getByRole('button', { name: 'Unmute sound' }).click()
  await expect(page.getByTestId('phase')).toHaveText('Short break')
  await startBtn(page).click()
  await page.clock.runFor(60_000)
  await expect(page.getByTestId('phase')).toHaveText('Focus')
  expect(await page.evaluate(() => (window as unknown as { __chimes?: number }).__chimes ?? 0)).toBe(1)
})

test('settings validate 1–90 and Escape cancels', async ({ page }, info) => {
  await page.getByRole('button', { name: 'Settings' }).click()
  const focus = page.getByRole('dialog').getByLabel('Focus', { exact: true })
  const save = page.getByRole('button', { name: 'Save' })
  for (const [v, msg] of [['0', 'between 1 and 90'], ['91', 'between 1 and 90'], ['', 'Enter a number'], ['2.5', 'whole minutes'], ['abc', 'whole minutes']]) {
    await focus.fill(v)
    await expect(page.getByRole('alert')).toContainText(msg)
    await expect(save).toBeDisabled()
  }
  await page.screenshot({ path: `shots/${info.project.name}-settings-invalid.png` })
  await focus.fill('90')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(save).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(countdown(page)).toHaveText('25:00') // cancelled
  await setDurations(page, '90', '1', '30')
  await expect(countdown(page)).toHaveText('90:00')
})

test('stays accurate when timers are throttled (background tab)', async ({ page }) => {
  await startBtn(page).click()
  await page.clock.runFor(1000)
  // Simulate a background tab: wall-clock time jumps 10 minutes while no interval ticks run.
  await page.clock.pauseAt(new Date('2026-11-09T09:10:01'))
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(countdown(page)).toHaveText('15:00')
  await expect(page).toHaveTitle('15:00 - Focus')
  // Jump far past the end: the session is logged at its real end time, 09:25.
  await page.clock.pauseAt(new Date('2026-11-09T10:30:00'))
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByTestId('phase')).toHaveText('Short break')
  await expect(page.getByTestId('log').locator('li')).toContainText('09:25')
})

test('settings, log, task and a running timer survive a reload', async ({ page }) => {
  await setDurations(page, '2', '3', '4')
  await page.getByLabel('Working on').fill('Inbox zero')
  await startBtn(page).click()
  await page.clock.runFor(2 * 60_000)
  await expect(page.getByTestId('log').locator('li')).toHaveCount(1)
  await startBtn(page).click() // start the 3 min break
  await page.clock.runFor(30_000)
  await page.reload()
  await expect(page.getByTestId('phase')).toHaveText('Short break')
  // Real time keeps passing during the reload, so allow a few seconds below 02:30 (never a reset to 03:00).
  await expect(countdown(page)).toHaveText(/^02:(30|2\d)$/)
  await expect(startBtn(page)).toHaveText('Pause')
  await expect(page.getByLabel('Working on')).toHaveValue('Inbox zero')
  await expect(page.getByTestId('log').locator('li')).toContainText('Inbox zero')
  await page.getByRole('button', { name: 'Settings' }).click()
  const d = page.getByRole('dialog')
  await expect(d.getByLabel('Focus', { exact: true })).toHaveValue('2')
  await expect(d.getByLabel('Short break')).toHaveValue('3')
  await expect(d.getByLabel('Recharge')).toHaveValue('4')
})

test('yesterday’s log is not shown today', async ({ page }) => {
  await page.evaluate(() =>
    localStorage.setItem('pomodoro.log', JSON.stringify([{ id: 'x', task: 'Old', finishedAt: new Date('2026-11-08T17:00:00').getTime(), minutes: 25 }])),
  )
  await page.reload()
  await expect(page.getByTestId('log-summary')).toHaveText('0 sessions · 0 min')
})
