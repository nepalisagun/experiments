import { describe, expect, it } from 'vitest'
import { addDays, csvFilename, lastDays, startOfWeek, streak, toCsv, weekMinutes } from './stats'
import type { LogEntry } from './timer'

// Wednesday 2026-11-11, 15:00 local.
const NOW = new Date(2026, 10, 11, 15, 0).getTime()
const at = (y: number, m: number, d: number, h = 10, min = 0) => new Date(y, m - 1, d, h, min).getTime()
let n = 0
const e = (finishedAt: number, minutes = 25, task = ''): LogEntry => ({ id: String(n++), task, finishedAt, minutes })

describe('lastDays', () => {
  it('returns 7 local days oldest → today with minutes and session counts', () => {
    const log = [e(at(2026, 11, 11, 9)), e(at(2026, 11, 11, 11), 50), e(at(2026, 11, 5, 23, 59), 10), e(at(2026, 11, 4, 23, 59), 99)]
    const days = lastDays(log, NOW)
    expect(days).toHaveLength(7)
    expect(new Date(days[0].start).getDate()).toBe(5)
    expect(new Date(days[6].start).getDate()).toBe(11)
    expect(days.map((d) => d.minutes)).toEqual([10, 0, 0, 0, 0, 0, 75])
    expect(days[6].sessions).toBe(2)
  })

  it('steps calendar days across a DST change and month boundaries', () => {
    // Covers 2026-03-29 (EU DST start) and 2026-03-08 (US DST start) whichever zone runs the test.
    for (const now of [at(2026, 4, 2, 0, 30), at(2026, 3, 12, 0, 30), at(2026, 3, 1, 12)]) {
      const days = lastDays([], now, 40)
      for (let i = 1; i < days.length; i++) {
        const a = new Date(days[i - 1].start)
        const b = new Date(days[i].start)
        expect(b.getHours()).toBe(0)
        expect(new Date(a.getFullYear(), a.getMonth(), a.getDate() + 1).getTime()).toBe(b.getTime())
      }
    }
  })
})

describe('weekMinutes', () => {
  it('sums Monday 00:00 through now', () => {
    expect(new Date(startOfWeek(NOW)).getDate()).toBe(9) // Monday 9 Nov
    const log = [e(at(2026, 11, 9, 0, 1)), e(at(2026, 11, 11), 50), e(at(2026, 11, 8, 23, 59)), e(at(2026, 11, 12))]
    expect(weekMinutes(log, NOW)).toBe(75)
  })

  it('treats Sunday as the last day of its week', () => {
    const sunday = at(2026, 11, 15, 20)
    expect(new Date(startOfWeek(sunday)).getDate()).toBe(9)
    expect(weekMinutes([e(at(2026, 11, 9)), e(at(2026, 11, 15))], sunday)).toBe(50)
  })

  it('is 0 with no history', () => expect(weekMinutes([], NOW)).toBe(0))
})

describe('streak', () => {
  it('counts consecutive days ending today', () => {
    expect(streak([e(at(2026, 11, 11)), e(at(2026, 11, 10)), e(at(2026, 11, 10, 18)), e(at(2026, 11, 9))], NOW)).toBe(3)
  })

  it('a gap ends the streak', () => {
    expect(streak([e(at(2026, 11, 11)), e(at(2026, 11, 9)), e(at(2026, 11, 8))], NOW)).toBe(1)
  })

  it('nothing yet today keeps yesterday’s streak alive', () => {
    expect(streak([e(at(2026, 11, 10)), e(at(2026, 11, 9))], NOW)).toBe(2)
  })

  it('is 0 when neither today nor yesterday has a session', () => {
    expect(streak([e(at(2026, 11, 9))], NOW)).toBe(0)
    expect(streak([], NOW)).toBe(0)
  })

  it('crosses month boundaries', () => {
    const now = at(2026, 12, 2)
    expect(streak([e(at(2026, 12, 2)), e(at(2026, 12, 1)), e(at(2026, 11, 30)), e(at(2026, 11, 29))], now)).toBe(4)
  })

  it('a long streak counts every day', () => {
    const log = Array.from({ length: 60 }, (_, i) => e(addDays(NOW, -i) + 10 * 3600_000))
    expect(streak(log, NOW)).toBe(60)
  })
})

describe('CSV export', () => {
  it('writes a header and every session oldest first, with local date and 24h time', () => {
    const csv = toCsv([e(at(2026, 11, 11, 14, 5), 25, 'Write report'), e(at(2026, 11, 3, 9, 7), 50, '')])
    expect(csv).toBe('date,time,task,minutes\r\n2026-11-03,09:07,,50\r\n2026-11-11,14:05,Write report,25\r\n')
  })

  it('quotes commas, quotes and newlines', () => {
    const csv = toCsv([e(NOW, 25, 'Email Bob, then "fix" it\nlater')])
    expect(csv.split('\r\n')[1]).toBe('2026-11-11,15:00,"Email Bob, then ""fix"" it\nlater",25')
  })

  it('neutralises spreadsheet formulas', () => {
    const csv = toCsv([e(NOW, 25, '=HYPERLINK("x")'), e(NOW + 1, 25, '-1+2')])
    const lines = csv.split('\r\n')
    expect(lines[1]).toBe(`2026-11-11,15:00,"'=HYPERLINK(""x"")",25`)
    expect(lines[2]).toBe("2026-11-11,15:00,'-1+2,25")
  })

  it('has only a header when empty, and a dated filename', () => {
    expect(toCsv([])).toBe('date,time,task,minutes\r\n')
    expect(csvFilename(NOW)).toBe('pomodoro-sessions-2026-11-11.csv')
  })
})
