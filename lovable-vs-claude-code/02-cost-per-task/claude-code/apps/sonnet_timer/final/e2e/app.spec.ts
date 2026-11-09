import { expect, test, type Page } from '@playwright/test'

const sizes = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 375, height: 667 },
]

async function setup(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __beeps: number }
    w.__beeps = 0
    const orig = AudioContext.prototype.createOscillator
    AudioContext.prototype.createOscillator = function () {
      w.__beeps++
      return orig.call(this)
    }
  })
  await page.clock.install({ time: new Date(2026, 5, 1, 9, 0, 0) })
  await page.goto('/')
}
const beeps = (page: Page) => page.evaluate(() => (window as unknown as { __beeps: number }).__beeps)
const countdown = (page: Page) => page.getByTestId('countdown')
const btn = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

for (const size of sizes) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } })

    test('full walkthrough', async ({ page }) => {
      await setup(page)
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(e.message))

      // 1 + 3: defaults, big display, title
      await expect(countdown(page)).toHaveText('25:00')
      await expect(page).toHaveTitle('25:00 - Focus')
      await page.screenshot({ path: `shots/${size.name}-1-idle.png`, fullPage: true })

      // no horizontal scroll
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

      // 4: task label; 2: start
      await page.getByPlaceholder('Optional task label').fill('Write report')
      await btn(page, 'Start').click()
      await page.clock.runFor(12 * 60_000 + 56_000) // 12:56 elapsed => 12:04 left
      await expect(countdown(page)).toHaveText('12:04')
      await expect(page).toHaveTitle('12:04 - Focus')

      // 2: pause freezes
      await btn(page, 'Pause').click()
      await page.clock.runFor(60_000)
      await expect(countdown(page)).toHaveText('12:04')
      await page.screenshot({ path: `shots/${size.name}-2-paused.png`, fullPage: true })

      // 2: space resumes / pauses (focus on body, not the input)
      await page.locator('body').click({ position: { x: 2, y: 2 } })
      await page.keyboard.press('Space')
      await page.clock.runFor(4_000)
      await expect(countdown(page)).toHaveText('12:00')
      await page.keyboard.press('Space')
      await page.clock.runFor(5_000)
      await expect(countdown(page)).toHaveText('12:00')

      // space inside the task input types a space and does not toggle
      await page.getByPlaceholder('Optional task label').press('End')
      await page.getByPlaceholder('Optional task label').pressSequentially(' x')
      await expect(page.getByPlaceholder('Optional task label')).toHaveValue('Write report x')
      await expect(btn(page, 'Start')).toBeVisible()
      await page.getByPlaceholder('Optional task label').fill('Write report')

      // space with a focused button must toggle once only
      await btn(page, 'Reset').focus()
      await page.keyboard.press('Space')
      await expect(btn(page, 'Pause')).toBeVisible()
      await page.keyboard.press('Space')
      await expect(btn(page, 'Start')).toBeVisible()
      await expect(countdown(page)).toHaveText('12:00') // Reset was not clicked

      // 2: reset
      await btn(page, 'Reset').click()
      await expect(countdown(page)).toHaveText('25:00')

      // 9: background accuracy - one big jump (no ticks in between)
      await btn(page, 'Start').click()
      await page.clock.fastForward(10 * 60_000)
      await expect(countdown(page)).toHaveText('15:00')
      await expect(page).toHaveTitle('15:00 - Focus')

      // 6/8/5: finish the focus session
      await page.clock.fastForward(15 * 60_000)
      await expect(page.getByTestId('phase')).toHaveText('Short break')
      await expect(countdown(page)).toHaveText('05:00')
      await expect(page).toHaveTitle('05:00 - Short break')
      expect(await beeps(page)).toBeGreaterThan(0)
      await expect(page.getByTestId('log').locator('li')).toHaveCount(1)
      await expect(page.getByTestId('log')).toContainText('Write report')
      await expect(page.getByTestId('log')).toContainText(/09:\d\d|9:\d\d/)
      await expect(page.getByTestId('dots').locator('[data-filled="true"]')).toHaveCount(1)
      await expect(page.getByTestId('dots')).toContainText('1 of 4')
      await page.screenshot({ path: `shots/${size.name}-3-break.png`, fullPage: true })

      // finish break, then three more focus sessions -> Recharge
      await btn(page, 'Start').click()
      await page.clock.fastForward(5 * 60_000)
      await expect(page.getByTestId('phase')).toHaveText('Focus')
      for (let i = 2; i <= 4; i++) {
        await btn(page, 'Start').click()
        await page.clock.fastForward(25 * 60_000)
        await expect(page.getByTestId('dots')).toContainText(`${i} of 4`)
        if (i < 4) {
          await expect(page.getByTestId('phase')).toHaveText('Short break')
          await btn(page, 'Skip').click() // skip break
        }
      }
      await expect(page.getByTestId('phase')).toHaveText('Recharge')
      await expect(countdown(page)).toHaveText('15:00')
      await expect(page.getByTestId('log').locator('li')).toHaveCount(4)
      await page.screenshot({ path: `shots/${size.name}-4-long.png`, fullPage: true })

      // 10: reload keeps log (and settings below)
      await page.reload()
      await expect(page.getByTestId('log').locator('li')).toHaveCount(4)
      await expect(page.getByTestId('log')).toContainText('Write report')

      // 4 sessions done = full cycle, so dots restart at 0 after reload
      await expect(page.getByTestId('dots')).toContainText('0 of 4')

      // reload mid-cycle keeps dot progress
      await btn(page, 'Start').click()
      await page.clock.fastForward(25 * 60_000)
      await expect(page.getByTestId('dots')).toContainText('1 of 4')
      await page.reload()
      await expect(page.getByTestId('dots')).toContainText('1 of 4')
      await expect(page.getByTestId('log').locator('li')).toHaveCount(5)

      expect(errors).toEqual([])
    })

    test('countdown size and fit, Recharge title', async ({ page }) => {
      await setup(page)
      const fontPx = await countdown(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      if (size.width === 375) expect(fontPx).toBeGreaterThanOrEqual(110) // was 90px
      // widest case: 90:00 must still fit inside the card
      await page.getByRole('button', { name: /Settings/ }).click()
      await page.getByRole('textbox').first().fill('90')
      await expect(countdown(page)).toHaveText('90:00')
      const fits = await countdown(page).evaluate((el) => {
        const r = document.createRange()
        r.selectNodeContents(el)
        const text = r.getBoundingClientRect()
        const box = el.getBoundingClientRect()
        return text.left >= box.left - 0.5 && text.right <= box.right + 0.5
      })
      expect(fits).toBe(true)
      await page.screenshot({ path: `shots/${size.name}-7-90.png`, fullPage: true })
      // title for the renamed phase
      await page.getByRole('textbox').first().fill('1')
      await page.getByRole('textbox').nth(1).fill('1')
      for (let i = 0; i < 4; i++) {
        await btn(page, 'Start').click()
        await page.clock.fastForward(60_000)
        if (i < 3) await btn(page, 'Skip').click()
      }
      await expect(page).toHaveTitle('15:00 - Recharge')
      await expect(page.getByTestId('dots')).toContainText('until Recharge')
      await expect(page.locator('body')).not.toContainText(/long break/i)
    })

    test('settings validation, persistence, mute', async ({ page }) => {
      await setup(page)
      await page.getByRole('button', { name: /Settings/ }).click()
      const [focus, short, long] = await page.getByRole('textbox').all().then((a) => a.slice(0, 3))
      void short
      await page.screenshot({ path: `shots/${size.name}-5-settings.png`, fullPage: true })

      for (const bad of ['0', '91', '', 'abc', '2.5']) {
        await focus.fill(bad)
        await expect(page.getByRole('alert')).toBeVisible()
        await expect(countdown(page)).toHaveText('25:00') // invalid never applied
      }
      await page.screenshot({ path: `shots/${size.name}-6-invalid.png`, fullPage: true })
      await focus.fill('50')
      await expect(page.getByRole('alert')).toHaveCount(0)
      await expect(countdown(page)).toHaveText('50:00')
      await long.fill('90')
      await page.getByRole('textbox').nth(1).fill('1')

      // mute toggle
      await page.getByRole('button', { name: /Sound on/ }).click()
      await expect(page.getByRole('button', { name: /Muted/ })).toBeVisible()

      await page.reload()
      await expect(countdown(page)).toHaveText('50:00')
      await expect(page.getByRole('button', { name: /Muted/ })).toBeVisible()
      await page.getByRole('button', { name: /Settings/ }).click()
      await expect(page.getByRole('textbox').nth(1)).toHaveValue('1')
      await expect(page.getByRole('textbox').nth(2)).toHaveValue('90')

      // muted: no sound at phase end; 1-minute break honored
      await btn(page, 'Start').click()
      await page.clock.fastForward(50 * 60_000)
      await expect(page.getByTestId('phase')).toHaveText('Short break')
      await expect(countdown(page)).toHaveText('01:00')
      expect(await beeps(page)).toBe(0)

      // unmuted: beeps
      await page.getByRole('button', { name: /Muted/ }).click()
      await btn(page, 'Start').click()
      await page.clock.fastForward(60_000)
      expect(await beeps(page)).toBeGreaterThan(0)
    })
  })
}
