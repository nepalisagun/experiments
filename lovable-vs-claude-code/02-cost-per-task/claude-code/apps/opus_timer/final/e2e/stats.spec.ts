import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const MIN = 60_000
// Monday 9 Nov 2026, 09:00 local.
const START = new Date(2026, 10, 9, 9, 0, 0)
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime()

// History spanning several days. The chart window is Tue 3 → Mon 9 Nov.
const HISTORY = [
  { id: 'a', task: 'Too old', finishedAt: at(2, 10), minutes: 25 },
  { id: 'b', task: 'Plan, "Q4"', finishedAt: at(5, 9), minutes: 25 },
  { id: 'c', task: 'Plan', finishedAt: at(5, 10), minutes: 25 },
  { id: 'd', task: '', finishedAt: at(5, 11), minutes: 25 },
  { id: 'e', task: 'Read', finishedAt: at(7, 15), minutes: 25 },
  { id: 'f', task: 'Write', finishedAt: at(8, 20), minutes: 50 },
  { id: 'g', task: 'Email', finishedAt: at(9, 8, 30), minutes: 25 },
]

async function seed(page: Page, history: unknown[]) {
  await page.evaluate((h) => localStorage.setItem('pomodoro.log', JSON.stringify(h)), history)
  await page.reload()
}

const openStats = (page: Page) => page.getByTestId('tab-stats').click()

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: START })
  await page.goto('/')
})

test('tabs switch between Timer and Stats', async ({ page }) => {
  await expect(page.getByTestId('tab-timer')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('timer-view')).toBeVisible()
  await openStats(page)
  await expect(page.getByTestId('tab-stats')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('stats-view')).toBeVisible()
  await expect(page.getByTestId('timer-view')).toHaveCount(0)

  // Arrow keys move between tabs.
  await page.getByTestId('tab-stats').focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('timer-view')).toBeVisible()
  await expect(page.getByTestId('tab-timer')).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('stats-view')).toBeVisible()
})

test('timer keeps running on the Stats tab, and Space does nothing there', async ({ page }) => {
  await page.getByTestId('start-pause').click()
  await openStats(page)
  await expect(page.getByTestId('running-dot')).toBeVisible()
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Space')
  await page.clock.fastForward(60_000)
  await page.getByTestId('tab-timer').click()
  await expect(page.getByTestId('start-pause')).toHaveText('Pause')
  await expect(page.getByTestId('time')).toHaveText('24:00')
})

test('chart, weekly total and streak reflect the stored history', async ({ page }, info) => {
  await seed(page, HISTORY)
  await openStats(page)
  const bars = page.getByTestId('bar')
  await expect(bars).toHaveCount(7)
  const minutes = await bars.evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-minutes'))))
  expect(minutes).toEqual([0, 0, 75, 0, 25, 50, 25]) // Tue 3 … Mon 9
  // Monday is the first day of the week, so only today's 25 minutes count.
  await expect(page.getByTestId('week-total')).toHaveText(/^25\s*min$/)
  // Sat 7, Sun 8, Mon 9 — Fri 6 is a gap.
  await expect(page.getByTestId('streak')).toHaveText(/^3\s*days$/)
  await expect(page.getByTestId('history-count')).toHaveText('7 completed sessions in total')

  // Hover (desktop) or tap (mobile) shows a tooltip for that day.
  if (info.project.name === 'mobile') await bars.nth(2).tap()
  else await bars.nth(2).hover()
  const tip = page.getByTestId('bar-tooltip')
  await expect(tip).toBeVisible()
  await expect(tip).toContainText('Nov 5')
  await expect(tip).toContainText('75 min · 3 sessions')
  await expect(tip).toBeInViewport({ ratio: 1 })
  await page.screenshot({ path: `shots/${info.project.name}-stats.png`, fullPage: true })

  // Tooltips on the first and last bars stay on screen too.
  for (const i of [0, 6]) {
    await bars.nth(i).focus()
    await expect(tip).toBeInViewport({ ratio: 1 })
  }

  // The table view lists the same numbers.
  await page.getByText('View as table').click()
  await expect(page.getByTestId('chart-table').locator('tbody tr')).toHaveCount(7)
  await expect(page.getByTestId('chart-table').locator('tbody tr').nth(2)).toContainText('75')
})

test('completing a focus session updates the stats', async ({ page }) => {
  await openStats(page)
  await expect(page.getByTestId('week-total')).toHaveText(/^0\s*min$/)
  await expect(page.getByTestId('streak')).toHaveText(/^0\s*days$/)
  await expect(page.getByTestId('export-csv')).toBeDisabled()

  await page.getByTestId('tab-timer').click()
  await page.getByTestId('task').fill('Deep work')
  await page.getByTestId('start-pause').click()
  await page.clock.fastForward(25 * MIN + 500)
  await expect(page.getByTestId('log-entry')).toHaveCount(1)

  await openStats(page)
  await expect(page.getByTestId('week-total')).toHaveText(/^25\s*min$/)
  await expect(page.getByTestId('streak')).toHaveText(/^1\s*day$/)
  await expect(page.getByTestId('bar').last()).toHaveAttribute('data-minutes', '25')
  await expect(page.getByTestId('export-csv')).toBeEnabled()
})

test('history across days survives reload; today\'s log still shows only today', async ({ page }) => {
  await seed(page, HISTORY)
  await expect(page.getByTestId('log-entry')).toHaveCount(1)
  await expect(page.getByTestId('log-entry')).toContainText('Email')
  await page.getByTestId('start-pause').click()
  await page.clock.fastForward(25 * MIN + 500)
  await page.reload()
  await openStats(page)
  await expect(page.getByTestId('history-count')).toHaveText('8 completed sessions in total')
  await expect(page.getByTestId('bar').last()).toHaveAttribute('data-minutes', '50')
})

test('Export CSV downloads every completed session', async ({ page }) => {
  await seed(page, HISTORY)
  await openStats(page)
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv').click()])
  expect(download.suggestedFilename()).toBe('pomodoro-sessions-2026-11-09.csv')
  const text = await readFile((await download.path())!, 'utf8')
  expect(text.charCodeAt(0)).toBe(0xfeff)
  expect(text.slice(1).split('\r\n')).toEqual([
    'date,time,task,minutes',
    '2026-11-02,10:00,Too old,25',
    '2026-11-05,09:00,"Plan, ""Q4""",25',
    '2026-11-05,10:00,Plan,25',
    '2026-11-05,11:00,,25',
    '2026-11-07,15:00,Read,25',
    '2026-11-08,20:00,Write,50',
    '2026-11-09,08:30,Email,25',
    '',
  ])
})

test('chart labels and a full-height tooltip stay clear of the heading', async ({ page }) => {
  // 60 minutes today → axis top is exactly 60, so today's bar is full height.
  await seed(page, [{ id: 'x', task: '', finishedAt: at(9, 8), minutes: 60 }])
  await openStats(page)
  const heading = (await page.locator('#chart-heading').boundingBox())!
  const topTick = (await page.getByTestId('chart').getByText('60', { exact: true }).boundingBox())!
  expect(topTick.y).toBeGreaterThanOrEqual(heading.y + heading.height)
  await page.getByTestId('bar').last().focus()
  const tip = (await page.getByTestId('bar-tooltip').boundingBox())!
  expect(tip.y).toBeGreaterThanOrEqual(heading.y + heading.height)
  await page.screenshot({ path: `shots/${test.info().project.name}-stats-full.png` })
})

test('stats layout fits the viewport', async ({ page }) => {
  await seed(page, HISTORY)
  await openStats(page)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  for (const id of ['tab-timer', 'tab-stats', 'mute', 'open-settings', 'week-total', 'streak', 'chart']) {
    await expect(page.getByTestId(id)).toBeInViewport()
  }
  // Day labels don't get truncated.
  const clipped = await page.getByTestId('chart').locator('span.truncate').evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth).length)
  expect(clipped).toBe(0)
})
