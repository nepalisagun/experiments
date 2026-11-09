import { expect, test, type Page } from '@playwright/test'

const MIN = 60_000
const START = new Date(2026, 10, 9, 9, 0, 0)

const time = (p: Page) => p.getByTestId('time')
const startPause = (p: Page) => p.getByTestId('start-pause')
const chimes = (p: Page) => p.evaluate(() => (window as unknown as { __chimeCount?: number }).__chimeCount ?? 0)

test.beforeEach(async ({ page }, info) => {
  await page.clock.install({ time: START })
  await page.goto('/')
  await expect(time(page)).toHaveText('25:00')
  await page.screenshot({ path: `shots/${info.project.name}-home.png`, fullPage: true })
})

/** Finish the current running phase by advancing the fake clock. */
async function finishPhase(page: Page, minutes: number) {
  await page.clock.fastForward(minutes * MIN + 500)
}

test('start, pause, resume, reset, and the tab title', async ({ page }) => {
  await expect(page).toHaveTitle('25:00 - Focus')
  await startPause(page).click()
  await expect(startPause(page)).toHaveText('Pause')
  await page.clock.fastForward(12 * MIN + 56_000)
  await expect(time(page)).toHaveText('12:04')
  await expect(page).toHaveTitle('12:04 - Focus')
  await page.screenshot({ path: `shots/${test.info().project.name}-running.png` })

  await startPause(page).click()
  await expect(startPause(page)).toHaveText('Resume')
  await page.clock.fastForward(5 * MIN)
  await expect(time(page)).toHaveText('12:04') // frozen while paused

  await startPause(page).click()
  await page.clock.runFor(4_000)
  await expect(time(page)).toHaveText('12:00')

  await page.getByTestId('reset').click()
  await expect(time(page)).toHaveText('25:00')
  await expect(startPause(page)).toHaveText('Start')
})

test('space bar starts and pauses, but not while typing a task', async ({ page }) => {
  await page.keyboard.press('Space')
  await expect(startPause(page)).toHaveText('Pause')
  await page.keyboard.press('Space')
  await expect(startPause(page)).toHaveText('Resume')

  // With a button focused, Space must toggle once (not also click the button).
  await page.getByTestId('skip').focus()
  await page.keyboard.press('Space')
  await expect(startPause(page)).toHaveText('Pause')
  await expect(page.getByTestId('phase')).toHaveAttribute('data-value', 'focus')

  await page.getByTestId('task').click()
  await page.keyboard.type('Write report')
  await expect(page.getByTestId('task')).toHaveValue('Write report')
  await expect(startPause(page)).toHaveText('Pause') // typing a space did not pause
})

test('full cycle: 4 focus sessions → Recharge, dots, log, and sound', async ({ page }) => {
  await page.getByTestId('task').fill('Draft chapter')
  const dots = page.getByTestId('cycle')
  await expect(dots).toContainText('0 of 4')

  for (let i = 1; i <= 4; i++) {
    await startPause(page).click()
    await finishPhase(page, 25)
    await expect(dots).toHaveAttribute('data-count', String(i))
    await expect(dots).toContainText(`${i} of 4`)
    await expect(page.getByTestId('log-entry')).toHaveCount(i)
    if (i < 4) {
      await expect(page.getByTestId('phase')).toHaveAttribute('data-value', 'short')
      await expect(time(page)).toHaveText('05:00')
      await expect(page).toHaveTitle('05:00 - Short break')
      await startPause(page).click()
      await finishPhase(page, 5)
      await expect(page.getByTestId('phase')).toHaveAttribute('data-value', 'focus')
    }
  }
  await expect(page.getByTestId('phase')).toHaveAttribute('data-value', 'long')
  await expect(time(page)).toHaveText('15:00')
  await expect(page).toHaveTitle('15:00 - Recharge')
  await expect(page.getByTestId('phase').locator('[aria-current="step"]')).toHaveText('Recharge')
  await expect(dots).toContainText('4 of 4 · Recharge earned')
  await expect(page.getByText(/long break/i)).toHaveCount(0)
  await expect(page.locator('[data-filled="true"]')).toHaveCount(4)
  expect(await chimes(page)).toBe(7) // 4 focus + 3 short breaks ended

  const first = page.getByTestId('log-entry').first()
  await expect(first).toContainText('Draft chapter')
  await expect(first).toContainText(/\d{1,2}:\d{2}/)
  await expect(page.getByTestId('log-summary')).toHaveText('4 sessions · 100 min')

  await page.screenshot({ path: `shots/${test.info().project.name}-recharge.png`, fullPage: true })
  await startPause(page).click()
  await finishPhase(page, 15)
  await expect(page.getByTestId('phase')).toHaveAttribute('data-value', 'focus')
  await expect(dots).toContainText('0 of 4')
})

test('log records the finish time and untitled sessions', async ({ page }) => {
  await startPause(page).click()
  await finishPhase(page, 25)
  const entry = page.getByTestId('log-entry')
  await expect(entry).toHaveCount(1)
  await expect(entry).toContainText('Untitled session')
  const expected = await page.evaluate((t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), START.getTime() + 25 * MIN)
  await expect(entry).toContainText(expected)
})

test('skip moves between phases without logging', async ({ page }) => {
  await page.getByTestId('skip').click()
  await expect(page.getByTestId('phase')).toHaveAttribute('data-value', 'short')
  await expect(time(page)).toHaveText('05:00')
  await page.getByTestId('skip').click()
  await expect(page.getByTestId('phase')).toHaveAttribute('data-value', 'focus')
  await expect(page.getByTestId('log-entry')).toHaveCount(0)
  await expect(page.getByTestId('cycle')).toContainText('0 of 4')
})

test('mute toggle silences the end-of-phase sound', async ({ page }) => {
  await page.getByTestId('mute').click()
  await expect(page.getByTestId('mute')).toHaveAttribute('aria-pressed', 'true')
  await startPause(page).click()
  await finishPhase(page, 25)
  await expect(page.getByTestId('log-entry')).toHaveCount(1)
  expect(await chimes(page)).toBe(0)

  await page.getByTestId('mute').click()
  await startPause(page).click()
  await finishPhase(page, 5)
  await expect(page.getByTestId('phase')).toHaveAttribute('data-value', 'focus')
  expect(await chimes(page)).toBe(1)
})

test('settings: validation, applying durations, and persistence', async ({ page }, info) => {
  await page.getByTestId('open-settings').click()
  const dialog = page.getByTestId('settings')
  await expect(dialog).toBeVisible()
  const save = page.getByTestId('save-settings')

  for (const bad of ['0', '91', '', '2.5', 'abc']) {
    await page.getByTestId('setting-focus').fill(bad)
    await expect(page.getByTestId('error-focus')).toBeVisible()
    await expect(save).toBeDisabled()
  }
  await page.getByTestId('setting-focus').fill('90')
  await page.getByTestId('setting-short').fill('1')
  await page.getByTestId('setting-long').fill('20')
  await expect(page.getByTestId('error-focus')).toHaveCount(0)
  await page.screenshot({ path: `shots/${info.project.name}-settings.png` })
  await save.click()
  await expect(dialog).toBeHidden()
  await expect(time(page)).toHaveText('90:00')

  await page.reload()
  await expect(time(page)).toHaveText('90:00')
  await page.getByTestId('open-settings').click()
  await expect(page.getByTestId('setting-short')).toHaveValue('1')
  await expect(page.getByTestId('setting-long')).toHaveValue('20')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  await page.getByTestId('skip').click()
  await expect(time(page)).toHaveText('01:00')
})

test("today's log and task label survive a reload", async ({ page }) => {
  await page.getByTestId('task').fill('Read paper')
  await startPause(page).click()
  await finishPhase(page, 25)
  await expect(page.getByTestId('log-entry')).toHaveCount(1)
  await page.reload()
  await expect(page.getByTestId('log-entry')).toHaveCount(1)
  await expect(page.getByTestId('log-entry')).toContainText('Read paper')
  await expect(page.getByTestId('task')).toHaveValue('Read paper')
  await expect(page.getByTestId('cycle')).toContainText('1 of 4')
})

test('stays accurate when timers are throttled in a background tab', async ({ page }) => {
  await startPause(page).click()
  await page.clock.runFor(1000)
  // Jump the wall clock 10 minutes forward WITHOUT running any timers,
  // as if the tab was backgrounded and no ticks fired.
  await page.clock.setSystemTime(START.getTime() + 1000 + 10 * MIN)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(time(page)).toHaveText('14:59')

  // And a phase that ended while in the background is completed on return.
  await page.clock.setSystemTime(START.getTime() + 40 * MIN)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await expect(page.getByTestId('phase')).toHaveAttribute('data-value', 'short')
  await expect(page.getByTestId('log-entry')).toHaveCount(1)
})

test('counts down in real time', async ({ page }) => {
  await startPause(page).click()
  await page.waitForTimeout(2300) // the installed clock still flows with real time
  await expect(time(page)).toHaveText(/24:5[78]/)
  await expect(page).toHaveTitle(/24:5[78] - Focus/)
})

test('the name "Recharge" is used in the dots label and settings, never "long break"', async ({ page }) => {
  await expect(page.getByTestId('cycle')).toContainText('0 of 4 until Recharge')
  await page.getByTestId('open-settings').click()
  const dialog = page.getByTestId('settings')
  await expect(dialog.getByText('Recharge', { exact: true })).toBeVisible()
  await expect(dialog).toContainText('A Recharge follows every 4 focus sessions.')
  await expect(page.locator('body')).not.toContainText(/long break/i)
})

test('countdown digits are large and fit inside the ring', async ({ page }, info) => {
  const box = await time(page).boundingBox()
  const ring = await time(page).locator('xpath=ancestor::div[contains(@class,"aspect-square")]').boundingBox()
  const size = await time(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  // Desktop is unchanged at 5.25rem; mobile went from 18vw (67.5px) to 24vw (90px at 375px).
  expect(size).toBeCloseTo(info.project.name === 'mobile' ? 90 : 84, 0)
  // Widest realistic value must still sit inside the ring's inner circle (~92% of its width).
  await time(page).evaluate((el) => (el.textContent = '88:88'))
  const wide = (await time(page).boundingBox())!
  expect(wide.width).toBeLessThan(ring!.width * 0.85)
  expect(box!.x).toBeGreaterThan(ring!.x)
})

test('layout fits the viewport without horizontal scroll', async ({ page }) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  for (const id of ['start-pause', 'reset', 'skip', 'task', 'mute', 'open-settings']) {
    await expect(page.getByTestId(id)).toBeInViewport()
  }
})
