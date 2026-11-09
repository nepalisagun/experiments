import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

// "Now" is Thursday 2026-11-12, 15:00 local time.
const NOW = '2026-11-12T15:00:00'
const at = (s: string) => new Date(s).getTime()

// Chart window is Fri 6 … Thu 12. Expected per day: Fri 25, Sat 30, Sun 0, Mon 25, Tue 25, Wed 75, Thu 50.
// This week (Mon 9 → now) = 175. Streak = Mon–Thu = 4 (Sunday is a gap). All history: 9 sessions, 329 min.
const HISTORY = [
  { id: 'a', task: 'Old planning', finishedAt: at('2026-11-05T10:00:00'), minutes: 99 },
  { id: 'b', task: 'Reading', finishedAt: at('2026-11-06T09:30:00'), minutes: 25 },
  { id: 'c', task: 'Weekend sketch', finishedAt: at('2026-11-07T11:00:00'), minutes: 30 },
  { id: 'd', task: '', finishedAt: at('2026-11-09T08:00:00'), minutes: 25 },
  { id: 'e', task: 'Email Bob, then "fix" it', finishedAt: at('2026-11-10T13:45:00'), minutes: 25 },
  { id: 'f', task: 'Write report', finishedAt: at('2026-11-11T09:00:00'), minutes: 25 },
  { id: 'g', task: 'Write report', finishedAt: at('2026-11-11T16:20:00'), minutes: 50 },
  { id: 'h', task: 'Review', finishedAt: at('2026-11-12T09:25:00'), minutes: 25 },
  { id: 'i', task: 'Review', finishedAt: at('2026-11-12T10:00:00'), minutes: 25 },
]

async function seed(page: Page, history: unknown[]) {
  await page.evaluate((h) => localStorage.setItem('pomodoro.log', JSON.stringify(h)), history)
  await page.reload()
  await expect(page).toHaveTitle(/ - /)
}

const statsTab = (p: Page) => p.getByRole('tab', { name: /^Stats/ })
const timerTab = (p: Page) => p.getByRole('tab', { name: /^Timer/ })
const bars = (p: Page) => p.getByTestId('chart').locator('li')

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(NOW) })
  await page.goto('/')
  await expect(page).toHaveTitle(/ - /)
})

test('tabs switch between Timer and Stats, by click and by arrow keys', async ({ page }) => {
  await expect(timerTab(page)).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('countdown')).toBeVisible()
  await statsTab(page).click()
  await expect(statsTab(page)).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel')).toHaveAttribute('id', 'panel-stats')
  await expect(page.getByTestId('countdown')).toHaveCount(0)
  await page.keyboard.press('ArrowLeft')
  await expect(timerTab(page)).toHaveAttribute('aria-selected', 'true')
  await expect(timerTab(page)).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(statsTab(page)).toHaveAttribute('aria-selected', 'true')
})

test('chart, week total and streak from a multi-day history', async ({ page }, info) => {
  await seed(page, HISTORY)
  await statsTab(page).click()
  await expect(bars(page)).toHaveCount(7)
  const minutes = await bars(page).evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-minutes'))))
  expect(minutes).toEqual([25, 30, 0, 25, 25, 75, 50])
  // Bar heights are proportional to minutes (scale max 90 for a 75-minute peak).
  const heights = await bars(page).evaluateAll((els) => els.map((el) => (el.querySelector('span[style*="background"]') as HTMLElement).offsetHeight))
  expect(heights[2]).toBe(0)
  expect(heights[5]).toBeGreaterThan(heights[6])
  expect(Math.abs(heights[5] / heights[6] - 75 / 50)).toBeLessThan(0.05)
  await expect(page.getByTestId('chart')).toContainText('Today')
  await expect(page.getByTestId('week-total')).toHaveText('175min')
  await expect(page.getByTestId('streak')).toHaveText('4days')
  await expect(page.getByTestId('history-count')).toHaveText('9 completed sessions · 329 min')
  // Accessible names and the screen-reader table carry the numbers too.
  await expect(bars(page).nth(5)).toHaveAttribute('aria-label', /Wednesday.*75 focus minutes, 2 sessions/)
  await expect(page.locator('table tbody tr')).toHaveCount(7)

  await bars(page).nth(5).hover()
  await expect(page.getByRole('tooltip')).toContainText('75 min · 2 sessions')
  await page.screenshot({ path: `shots/${info.project.name}-stats.png`, fullPage: true })
  // Tooltips on the edge bars stay on screen.
  for (const i of [0, 6]) {
    await bars(page).nth(i).hover()
    const tip = await page.getByRole('tooltip').boundingBox()
    const vw = page.viewportSize()!.width
    expect(tip!.x).toBeGreaterThanOrEqual(0)
    expect(tip!.x + tip!.width).toBeLessThanOrEqual(vw)
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('completing a focus session updates Stats; the timer keeps running on the Stats tab', async ({ page }) => {
  await seed(page, HISTORY)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('dialog').getByLabel('Focus', { exact: true }).fill('1')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await page.getByRole('button', { name: 'Start' }).click()
  await statsTab(page).click()
  await page.clock.runFor(20_000)
  await expect(page.getByTestId('tab-time')).toHaveText('00:40') // remaining time shown on the Timer tab
  await page.clock.runFor(40_000)
  await expect(bars(page).nth(6)).toHaveAttribute('data-minutes', '51')
  await expect(page.getByTestId('week-total')).toHaveText('176min')
  await expect(page.getByTestId('history-count')).toHaveText('10 completed sessions · 330 min')
  await timerTab(page).click()
  await expect(page.getByTestId('phase')).toHaveText('Short break')
  // The Today list still shows only today's sessions, while history is kept in storage.
  await expect(page.getByTestId('log-summary')).toHaveText('3 sessions · 51 min')
  await page.reload()
  await statsTab(page).click()
  await expect(page.getByTestId('history-count')).toHaveText('10 completed sessions · 330 min')
})

test('streak starts from today when the first session of a new day completes', async ({ page }) => {
  // History ends Sunday, so on Thursday the streak is 0; after one session today it is 1.
  await seed(page, [{ id: 'x', task: '', finishedAt: at('2026-11-08T10:00:00'), minutes: 25 }])
  await statsTab(page).click()
  await expect(page.getByTestId('streak')).toHaveText('0days')
  await timerTab(page).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('dialog').getByLabel('Focus', { exact: true }).fill('1')
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click()
  await page.getByRole('button', { name: 'Start' }).click()
  await page.clock.runFor(60_000)
  await statsTab(page).click()
  await expect(page.getByTestId('streak')).toHaveText('1day')
})

test('Export CSV downloads every session with date, time, task and minutes', async ({ page }) => {
  await seed(page, HISTORY)
  await statsTab(page).click()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()])
  expect(download.suggestedFilename()).toBe('pomodoro-sessions-2026-11-12.csv')
  const text = await readFile((await download.path())!, 'utf8')
  expect(text.charCodeAt(0)).toBe(0xfeff)
  const lines = text.slice(1).trimEnd().split('\r\n')
  expect(lines).toEqual([
    'date,time,task,minutes',
    '2026-11-05,10:00,Old planning,99',
    '2026-11-06,09:30,Reading,25',
    '2026-11-07,11:00,Weekend sketch,30',
    '2026-11-09,08:00,,25',
    '2026-11-10,13:45,"Email Bob, then ""fix"" it",25',
    '2026-11-11,09:00,Write report,25',
    '2026-11-11,16:20,Write report,50',
    '2026-11-12,09:25,Review,25',
    '2026-11-12,10:00,Review,25',
  ])
})

test('empty history: zeros, an empty-chart message and a disabled export', async ({ page }, info) => {
  await statsTab(page).click()
  await expect(page.getByTestId('week-total')).toHaveText('0min')
  await expect(page.getByTestId('streak')).toHaveText('0days')
  await expect(page.getByText('No focus sessions in the last 7 days yet.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
  await page.screenshot({ path: `shots/${info.project.name}-stats-empty.png`, fullPage: true })
})
