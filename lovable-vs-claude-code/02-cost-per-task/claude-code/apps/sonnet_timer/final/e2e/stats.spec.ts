import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const sizes = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 375, height: 667 },
]

/** Fake clock = Mon 2026-06-01 09:00 local. Seed history (local times):
 *  Jun 1: 25+25  | May 31: 25 | May 30: 25+50 | May 29: none | May 28: 25 | May 27: 25 | May 26: none | May 25: 25 (outside 7 days)
 *  => bars [0,25,25,0,75,25,50], week total 200, streak 3, 8 sessions saved. */
async function setup(page: Page, seed = true) {
  await page.addInitScript((doSeed) => {
    if (!doSeed || localStorage.getItem('pomodoro.log')) return
    const t = (m: number, d: number, h: number, min = 0) => new Date(2026, m - 1, d, h, min).getTime()
    const rows: [number, number, string, number][] = [
      [t(6, 1, 8, 5), 25, 'Email, "inbox" zero', 0],
      [t(6, 1, 8, 40), 25, '=SUM(A1)', 0],
      [t(5, 31, 15), 25, 'Weekend plan', 0],
      [t(5, 30, 10), 25, '', 0],
      [t(5, 30, 11), 50, 'Deep work', 0],
      [t(5, 28, 9), 25, 'Review', 0],
      [t(5, 27, 9), 25, 'Review', 0],
      [t(5, 25, 9), 25, 'Old', 0],
    ]
    localStorage.setItem(
      'pomodoro.log',
      JSON.stringify(rows.map(([ts, minutes, label], i) => ({ id: `s${i}`, label, finishedAt: ts, minutes }))),
    )
  }, seed)
  await page.clock.install({ time: new Date(2026, 5, 1, 9, 0, 0) })
  await page.goto('/')
}
const tab = (page: Page, name: string) => page.getByRole('tab', { name, exact: true })

for (const size of sizes) {
  test.describe(`stats ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } })

    test('tabs, chart, total, streak', async ({ page }) => {
      await setup(page)
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))

      // tabs switch views
      await expect(tab(page, 'Timer')).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByTestId('countdown')).toBeVisible()
      await tab(page, 'Stats').click()
      await expect(tab(page, 'Stats')).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByTestId('countdown')).toHaveCount(0)
      await expect(page.getByTestId('chart')).toBeVisible()

      // chart: 7 bars, oldest first, correct minutes and days
      const bars = page.getByTestId('bar')
      await expect(bars).toHaveCount(7)
      const mins = await bars.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-minutes'))))
      expect(mins).toEqual([0, 25, 25, 0, 75, 25, 50])
      const days = await bars.evaluateAll((els) => els.map((e) => e.getAttribute('data-day')))
      expect(days[0]).toBe('2026-05-26')
      expect(days[6]).toBe('2026-06-01')
      // bar heights are proportional (75 is tallest; 0 is flat)
      const hs = await bars.evaluateAll((els) => els.map((e) => e.querySelector('rect')!.getBoundingClientRect().height))
      expect(hs[4]).toBeGreaterThan(hs[6])
      expect(hs[6]).toBeGreaterThan(hs[1])
      expect(hs[0]).toBe(0)
      expect(hs[1]).toBeCloseTo(hs[2], 1)
      // all bar labels visible inside the svg (no clipping at either size)
      const svgBox = (await page.getByTestId('chart').boundingBox())!
      for (const label of await page.getByTestId('chart').locator('text').all()) {
        const b = (await label.boundingBox())!
        expect(b.x).toBeGreaterThanOrEqual(svgBox.x - 0.5)
        expect(b.x + b.width).toBeLessThanOrEqual(svgBox.x + svgBox.width + 0.5)
        expect(b.y).toBeGreaterThanOrEqual(svgBox.y - 0.5)
      }

      await expect(page.getByTestId('week-total')).toHaveAttribute('data-minutes', '200')
      await expect(page.getByTestId('week-total')).toHaveText('3 h 20 min')
      await expect(page.getByTestId('streak')).toHaveAttribute('data-days', '3')
      // stat values stay on one line and inside their cards
      for (const id of ['week-total', 'streak']) {
        const h = await page.getByTestId(id).evaluate((el) => el.getBoundingClientRect().height)
        expect(h).toBeLessThan(45)
      }
      await expect(page.getByTestId('history-count')).toContainText('8 completed sessions')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await page.screenshot({ path: `shots/${size.name}-stats.png`, fullPage: true })

      // back to timer keeps working
      await tab(page, 'Timer').click()
      await expect(page.getByTestId('countdown')).toHaveText('25:00')
      // keyboard: arrow switches tabs
      await tab(page, 'Timer').focus()
      await page.keyboard.press('ArrowRight')
      await expect(tab(page, 'Stats')).toHaveAttribute('aria-selected', 'true')
      expect(errors).toEqual([])
    })

    test('export CSV downloads all sessions', async ({ page }) => {
      await setup(page)
      await tab(page, 'Stats').click()
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()])
      expect(dl.suggestedFilename()).toBe('pomodoro-sessions-2026-06-01.csv')
      const text = readFileSync((await dl.path())!, 'utf8').replace(/^﻿/, '')
      expect(text.split('\r\n')).toEqual([
        'Date,Time,Task,Minutes',
        '2026-05-25,09:00,Old,25',
        '2026-05-27,09:00,Review,25',
        '2026-05-28,09:00,Review,25',
        '2026-05-30,10:00,,25',
        '2026-05-30,11:00,Deep work,50',
        '2026-05-31,15:00,Weekend plan,25',
        '2026-06-01,08:05,"Email, ""inbox"" zero",25',
        "2026-06-01,08:40,'=SUM(A1),25",
        '',
      ])
    })

    test('new session updates history, chart, streak, and survives reload', async ({ page }) => {
      await setup(page)
      await page.getByPlaceholder('Optional task label').fill('Live session')
      await page.getByRole('button', { name: 'Start', exact: true }).click()
      // Space on the Stats tab must not toggle the timer
      await tab(page, 'Stats').click()
      await page.locator('body').click({ position: { x: 2, y: 2 } })
      await page.keyboard.press('Space')
      await tab(page, 'Timer').click()
      await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
      await page.clock.fastForward(25 * 60_000)
      await tab(page, 'Stats').click()
      await expect(page.getByTestId('week-total')).toHaveAttribute('data-minutes', '225')
      await expect(page.getByTestId('bar').last()).toHaveAttribute('data-minutes', '75')
      await expect(page.getByTestId('history-count')).toContainText('9 completed')
      await page.reload()
      await tab(page, 'Stats').click()
      await expect(page.getByTestId('week-total')).toHaveAttribute('data-minutes', '225')
      const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()])
      expect(readFileSync((await dl.path())!, 'utf8')).toContain('Live session,25')
    })

    test('empty state', async ({ page }) => {
      await setup(page, false)
      await tab(page, 'Stats').click()
      await expect(page.getByTestId('week-total')).toHaveAttribute('data-minutes', '0')
      await expect(page.getByTestId('streak')).toHaveAttribute('data-days', '0')
      await expect(page.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
      const mins = await page.getByTestId('bar').evaluateAll((els) => els.map((e) => e.getAttribute('data-minutes')))
      expect(mins).toEqual(['0', '0', '0', '0', '0', '0', '0'])
      await page.screenshot({ path: `shots/${size.name}-stats-empty.png`, fullPage: true })
    })
  })
}
