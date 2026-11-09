import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

const SIZES = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 375, height: 667 },
]

const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime()
// "now" in the page is Mon 9 Nov 2026 10:00. Window = 3..9 Nov.
const SEED = [
  { id: 'a', task: 'Old, outside window', finishedAt: at(1, 9), minutes: 25 },
  { id: 'b', task: 'Plan "sprint"', finishedAt: at(4, 9, 15), minutes: 25 },
  { id: 'c', task: '', finishedAt: at(6, 9), minutes: 30 },
  { id: 'd', task: 'Write docs', finishedAt: at(7, 9), minutes: 25 },
  { id: 'e', task: '=HYPERLINK("x")', finishedAt: at(7, 11), minutes: 25 },
  { id: 'f', task: 'Review', finishedAt: at(8, 16, 45), minutes: 25 },
]

async function open(page: Page, seed = true) {
  if (seed) {
    await page.addInitScript((s) => {
      if (!localStorage.getItem('pomodoro.log.v1')) localStorage.setItem('pomodoro.log.v1', JSON.stringify(s))
    }, SEED)
  }
  await page.clock.install({ time: new Date(2026, 10, 9, 10, 0, 0) })
  await page.goto('/')
  await page.clock.runFor(100)
}

for (const size of SIZES) {
  test.describe('stats ' + size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } })

    test('tabs switch between Timer and Stats', async ({ page }) => {
      await open(page)
      await expect(page.getByRole('tab', { name: 'Timer' })).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByTestId('countdown')).toBeVisible()
      await expect(page.getByTestId('stats')).toHaveCount(0)
      await page.getByRole('tab', { name: 'Stats' }).click()
      await expect(page.getByRole('tab', { name: 'Stats' })).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByTestId('stats')).toBeVisible()
      await expect(page.getByTestId('countdown')).toHaveCount(0)
      await page.getByRole('tab', { name: 'Timer' }).click()
      await expect(page.getByTestId('countdown')).toBeVisible()
    })

    test('chart, weekly total and streak from saved history', async ({ page }) => {
      await open(page)
      await page.getByRole('tab', { name: 'Stats' }).click()
      const bars = page.getByTestId('bar')
      await expect(bars).toHaveCount(7)
      expect(await bars.evaluateAll((els) => els.map((e) => e.getAttribute('data-day')))).toEqual([
        '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09',
      ])
      expect(await bars.evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-minutes'))))).toEqual([0, 25, 0, 30, 50, 25, 0])
      await expect(page.getByTestId('week-total')).toContainText('130')
      // today (9th) empty, 8th/7th/6th present, 5th missing → streak 3 (still alive)
      await expect(page.getByTestId('streak')).toContainText('3')
      // bar heights are proportional: 50 min bar is taller than the 25 min bar
      const h = await page.locator('[data-testid=bar] > div > div').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))
      expect(h[4]).toBeGreaterThan(h[1])
      expect(h[0]).toBeLessThan(5)
      // no horizontal overflow, and the day labels don't clip
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0)
      await page.screenshot({ path: 'shots/' + size.name + '-stats.png', fullPage: true })
    })

    test('finishing a focus session updates chart, total and streak; history survives reload', async ({ page }) => {
      await open(page)
      await page.getByLabel('Task label').fill('Fresh')
      await page.getByRole('button', { name: 'Start' }).click()
      await page.clock.fastForward(25 * 60_000 + 1000)
      await page.clock.runFor(300)
      await page.getByRole('tab', { name: 'Stats' }).click()
      await expect(page.getByTestId('week-total')).toContainText('155')
      await expect(page.getByTestId('streak')).toContainText('4')
      await expect(page.getByTestId('bar').last()).toHaveAttribute('data-minutes', '25')
      await page.reload()
      await page.clock.runFor(100)
      await page.getByRole('tab', { name: 'Stats' }).click()
      await expect(page.getByTestId('week-total')).toContainText('155')
      await expect(page.getByTestId('streak')).toContainText('4')
      // the Timer tab's Today list shows only today's session, not the seeded history
      await page.getByRole('tab', { name: 'Timer' }).click()
      await expect(page.getByTestId('log').locator('li')).toHaveCount(1)
      await expect(page.getByTestId('log')).toContainText('Fresh')
    })

    test('minutes use the focus length in force when the session finished', async ({ page }) => {
      await open(page, false)
      await page.getByRole('button', { name: /Settings/ }).click()
      await page.getByLabel('Focus minutes').fill('10')
      await page.getByRole('button', { name: 'Save' }).click()
      await page.getByRole('button', { name: 'Start' }).click()
      await page.clock.fastForward(10 * 60_000 + 1000)
      await page.clock.runFor(300)
      await page.getByRole('tab', { name: 'Stats' }).click()
      await expect(page.getByTestId('week-total')).toContainText('10')
      await expect(page.getByTestId('streak')).toContainText('1')
    })

    test('Space does not start the timer while on the Stats tab', async ({ page }) => {
      await open(page, false)
      await page.getByRole('tab', { name: 'Stats' }).click()
      await page.locator('body').click({ position: { x: 3, y: 3 } })
      await page.keyboard.press('Space')
      await page.clock.runFor(3000)
      await page.getByRole('tab', { name: 'Timer' }).click()
      await expect(page.getByTestId('countdown')).toHaveText('25:00')
    })

    test('empty state, with Export disabled', async ({ page }) => {
      await open(page, false)
      await page.getByRole('tab', { name: 'Stats' }).click()
      await expect(page.getByTestId('week-total')).toContainText('0')
      await expect(page.getByTestId('streak')).toContainText('0')
      await expect(page.getByText('No focus sessions in the last 7 days yet.')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
    })

    test('Export CSV downloads every completed session, including older days', async ({ page }) => {
      await open(page)
      await page.getByRole('tab', { name: 'Stats' }).click()
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()])
      expect(download.suggestedFilename()).toBe('pomodoro-sessions-2026-11-09.csv')
      const text = readFileSync(await download.path(), 'utf8').replace(/^﻿/, '')
      expect(text.split('\r\n')).toEqual([
        'date,time,task,minutes',
        '2026-11-01,09:00,"Old, outside window",25',
        '2026-11-04,09:15,"Plan ""sprint""",25',
        '2026-11-06,09:00,,30',
        '2026-11-07,09:00,Write docs,25',
        '2026-11-07,11:00,"\'=HYPERLINK(""x"")",25',
        '2026-11-08,16:45,Review,25',
        '',
      ])
    })

    test('old saved entries without minutes still load (default 25 min)', async ({ page }) => {
      await page.addInitScript(() => {
        localStorage.setItem('pomodoro.log.v1', JSON.stringify([{ id: 'x', task: 'legacy', finishedAt: new Date(2026, 10, 8, 12).getTime() }]))
      })
      await open(page, false)
      await page.getByRole('tab', { name: 'Stats' }).click()
      await expect(page.getByTestId('week-total')).toContainText('25')
      await expect(page.getByTestId('streak')).toContainText('1')
    })
  })
}
