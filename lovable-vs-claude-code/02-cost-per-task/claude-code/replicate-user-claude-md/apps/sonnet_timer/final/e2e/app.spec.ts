import { test, expect, type Page } from '@playwright/test'

const SIZES = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 375, height: 667 },
]

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } })

    const open = async (page: Page) => {
      await page.clock.install({ time: new Date(2026, 10, 9, 10, 0, 0) })
      await page.goto('/')
      await page.clock.runFor(100) // let React flush effects under the fake clock
    }
    const countdown = (page: Page) => page.getByTestId('countdown')
    const finishPhase = async (page: Page, minutes: number) => {
      // jump the clock (like a throttled tab waking up), then let the next tick fire
      await page.clock.fastForward(minutes * 60_000 + 1000)
      await page.clock.runFor(300)
    }

    test('initial view, no horizontal scroll, title', async ({ page }) => {
      await open(page)
      await expect(countdown(page)).toHaveText('25:00')
      await expect(page).toHaveTitle('25:00 - Focus')
      await expect(page.getByTestId('dots-text')).toHaveText('0 of 4')
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow).toBeLessThanOrEqual(0)
      // digits: 88px on mobile (was 72px), 96px from the sm breakpoint up; and they stay inside the ring
      const fs = await countdown(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      expect(fs).toBe(size.width < 640 ? 88 : 96)
      const box = (await countdown(page).evaluate((el) => {
        const r = document.createRange()
        r.selectNodeContents(el)
        return r.getBoundingClientRect().width
      })) as number
      expect(box).toBeLessThan(260)
      await page.screenshot({ path: 'shots/' + size.name + '-home.png', fullPage: true })
    })

    test('start / pause / reset / skip and tab title', async ({ page }) => {
      await open(page)
      await page.getByRole('button', { name: 'Start' }).click()
      await page.clock.runFor(61_000)
      await expect(countdown(page)).toHaveText('23:59')
      await expect(page).toHaveTitle('23:59 - Focus')
      await page.getByRole('button', { name: 'Pause' }).click()
      await page.clock.runFor(60_000)
      await expect(countdown(page)).toHaveText('23:59')
      await page.getByRole('button', { name: 'Start' }).click()
      await page.clock.runFor(1000)
      await expect(countdown(page)).toHaveText('23:58')
      await page.getByRole('button', { name: 'Reset' }).click()
      await expect(countdown(page)).toHaveText('25:00')
      await expect(page.getByRole('button', { name: 'Start' })).toBeVisible()
      await page.getByRole('button', { name: 'Skip' }).click()
      await expect(page.getByTestId('phase')).toHaveText('Short break')
      await expect(page).toHaveTitle('05:00 - Short break')
      await expect(page.getByTestId('dots-text')).toHaveText('0 of 4')
    })

    test('space bar starts and pauses, but not while typing', async ({ page }) => {
      await open(page)
      await page.keyboard.press('Space')
      await page.clock.runFor(5000)
      await expect(countdown(page)).toHaveText('24:55')
      await page.keyboard.press('Space')
      await page.clock.runFor(5000)
      await expect(countdown(page)).toHaveText('24:55')
      await page.getByLabel('Task label').click()
      await page.keyboard.type('a b')
      await expect(page.getByLabel('Task label')).toHaveValue('a b')
      await page.clock.runFor(2000)
      await expect(countdown(page)).toHaveText('24:55') // still paused
    })

    test('completing focus logs task+time, fills dots; full cycle reaches long break', async ({ page }) => {
      await open(page)
      await page.getByLabel('Task label').fill('Write report')
      await page.getByRole('button', { name: 'Start' }).click()
      await finishPhase(page, 25)
      await expect(page.getByTestId('phase')).toHaveText('Short break')
      await expect(page.getByTestId('dots-text')).toHaveText('1 of 4')
      await expect(page.getByTestId('log').locator('li')).toHaveCount(1)
      await expect(page.getByTestId('log')).toContainText('Write report')
      await expect(page.getByTestId('log').locator('time')).toHaveText(/10:2\d/)

      for (let i = 2; i <= 4; i++) {
        await page.getByRole('button', { name: 'Start' }).click()
        await finishPhase(page, 5) // break
        await expect(page.getByTestId('phase')).toHaveText('Focus')
        await page.getByRole('button', { name: 'Start' }).click()
        await finishPhase(page, 25)
        await expect(page.getByTestId('dots-text')).toHaveText(i + ' of 4')
      }
      await expect(page.getByTestId('phase')).toHaveText('Recharge')
      await expect(page).toHaveTitle('15:00 - Recharge')
      await expect(page.getByTestId('log').locator('li')).toHaveCount(4)
      await page.screenshot({ path: 'shots/' + size.name + '-cycle.png', fullPage: true })
      await page.getByRole('button', { name: 'Start' }).click()
      await finishPhase(page, 15)
      await expect(page.getByTestId('phase')).toHaveText('Focus')
      await expect(page.getByTestId('dots-text')).toHaveText('0 of 4')
    })

    test('settings validate, apply, and persist with the log across reload', async ({ page }) => {
      await open(page)
      await page.getByRole('button', { name: /Settings/ }).click()
      const focus = page.getByLabel('Focus minutes')
      await focus.fill('0')
      await expect(page.getByRole('alert')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()
      await focus.fill('91')
      await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()
      await focus.fill('abc')
      await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled()
      await focus.fill('1')
      await page.getByLabel('Short break minutes').fill('2')
      await page.getByLabel('Recharge minutes').fill('3')
      await page.getByRole('button', { name: 'Save' }).click()
      await expect(countdown(page)).toHaveText('01:00')
      await page.screenshot({ path: 'shots/' + size.name + '-settings.png', fullPage: true })

      await page.getByLabel('Task label').fill('Persisted task')
      await page.getByRole('button', { name: 'Start' }).click()
      await finishPhase(page, 1)
      await expect(page.getByTestId('log')).toContainText('Persisted task')

      await page.reload()
      await expect(page.getByTestId('log')).toContainText('Persisted task')
      await expect(countdown(page)).toHaveText('01:00')
      await page.getByRole('button', { name: /Settings/ }).click()
      await expect(page.getByLabel('Short break minutes')).toHaveValue('2')
      await expect(page.getByLabel('Recharge minutes')).toHaveValue('3')
    })

    test('mute toggle persists and sound plays only when unmuted', async ({ page }) => {
      await page.addInitScript(() => {
        ;(window as unknown as { beeps: number }).beeps = 0
        const Orig = window.AudioContext
        window.AudioContext = class extends Orig {
          createOscillator() {
            ;(window as unknown as { beeps: number }).beeps++
            return super.createOscillator()
          }
        }
      })
      await open(page)
      await page.getByRole('button', { name: 'Start' }).click()
      await finishPhase(page, 25)
      expect(await page.evaluate(() => (window as unknown as { beeps: number }).beeps)).toBeGreaterThan(0)

      const before = await page.evaluate(() => (window as unknown as { beeps: number }).beeps)
      await page.getByRole('button', { name: 'Mute sound' }).click()
      await expect(page.getByRole('button', { name: 'Unmute sound' })).toBeVisible()
      await page.getByRole('button', { name: 'Start' }).click()
      await finishPhase(page, 5)
      expect(await page.evaluate(() => (window as unknown as { beeps: number }).beeps)).toBe(before)
      await page.reload()
      await expect(page.getByRole('button', { name: 'Unmute sound' })).toBeVisible()
    })

    test('timer stays accurate when time jumps while the tab is hidden', async ({ page }) => {
      await open(page)
      await page.getByRole('button', { name: 'Start' }).click()
      // simulate a throttled background tab: no timers fire, wall clock moves 10 minutes
      await page.clock.fastForward(10 * 60_000)
      await expect(countdown(page)).toHaveText('15:00')
    })
  })
}
