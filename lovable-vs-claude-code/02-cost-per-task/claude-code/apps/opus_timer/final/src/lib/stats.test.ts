import { describe, expect, it } from 'vitest'
import type { LogEntry } from './log'
import { currentStreak, formatMinutes, lastNDays, niceScale, startOfWeek, toCsv, weekMinutes } from './stats'

// Wednesday 11 Nov 2026, 15:00 local time.
const NOW = new Date(2026, 10, 11, 15, 0).getTime()
const at = (month: number, day: number, h = 10, m = 0) => new Date(2026, month, day, h, m).getTime()
let n = 0
const e = (finishedAt: number, minutes = 25, task = ''): LogEntry => ({ id: String(n++), task, finishedAt, minutes })

describe('lastNDays', () => {
  it('returns 7 days oldest→newest ending today, summing minutes and sessions per local day', () => {
    const log = [e(at(10, 11, 9)), e(at(10, 11, 14), 50), e(at(10, 9, 23, 59)), e(at(10, 5, 0, 0)), e(at(10, 4, 23, 59))]
    const days = lastNDays(log, NOW)
    expect(days.map((d) => d.key)).toEqual(['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11'])
    expect(days.map((d) => d.minutes)).toEqual([25, 0, 0, 0, 25, 0, 75])
    expect(days.map((d) => d.sessions)).toEqual([1, 0, 0, 0, 1, 0, 2])
  })

  it('handles an empty history', () => {
    expect(lastNDays([], NOW).every((d) => d.minutes === 0)).toBe(true)
  })

  it('crosses a month boundary and a DST change without skipping or repeating days', () => {
    // Tests run in America/New_York (see vite.config.ts), where 1 Nov 2026 is a 25-hour day.
    expect(new Date(2026, 9, 31).getTimezoneOffset()).not.toBe(new Date(2026, 10, 2).getTimezoneOffset())
    const keys = lastNDays([], new Date(2026, 10, 3, 12).getTime()).map((d) => d.key)
    expect(keys).toEqual(['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'])
    expect(new Set(lastNDays([], new Date(2026, 3, 2).getTime(), 30).map((d) => d.key)).size).toBe(30)
  })
})

describe('weekMinutes', () => {
  it('sums minutes since Monday 00:00 of the current week', () => {
    expect(startOfWeek(NOW)).toEqual(new Date(2026, 10, 9)) // Monday
    const log = [e(at(10, 8, 23, 59), 25), e(at(10, 9, 0, 0), 30), e(at(10, 11, 9), 50)]
    expect(weekMinutes(log, NOW)).toBe(80)
  })

  it('treats Sunday as the end of the week, not the start', () => {
    const sunday = new Date(2026, 10, 15, 20).getTime()
    expect(startOfWeek(sunday)).toEqual(new Date(2026, 10, 9))
    expect(weekMinutes([e(at(10, 9)), e(at(10, 15, 8))], sunday)).toBe(50)
  })

  it('is 0 with no sessions this week', () => {
    expect(weekMinutes([e(at(10, 1))], NOW)).toBe(0)
  })
})

describe('currentStreak', () => {
  it('counts consecutive days ending today', () => {
    expect(currentStreak([e(at(10, 11)), e(at(10, 10)), e(at(10, 10, 12)), e(at(10, 9)), e(at(10, 7))], NOW)).toBe(3)
  })

  it('stays alive from yesterday if today has no session yet', () => {
    expect(currentStreak([e(at(10, 10)), e(at(10, 9))], NOW)).toBe(2)
  })

  it('is broken by a missed day', () => {
    expect(currentStreak([e(at(10, 9)), e(at(10, 8))], NOW)).toBe(0)
    expect(currentStreak([], NOW)).toBe(0)
  })

  it('spans month boundaries', () => {
    const now = new Date(2026, 11, 2, 9).getTime()
    const log = [e(new Date(2026, 11, 2, 8).getTime()), e(new Date(2026, 11, 1).getTime()), e(new Date(2026, 10, 30).getTime())]
    expect(currentStreak(log, now)).toBe(3)
  })
})

describe('niceScale', () => {
  it('picks a round top with at most 4 steps', () => {
    expect(niceScale(0)).toEqual({ top: 60, step: 30 })
    expect(niceScale(25)).toEqual({ top: 30, step: 15 })
    expect(niceScale(75)).toEqual({ top: 90, step: 30 })
    expect(niceScale(100)).toEqual({ top: 120, step: 30 })
    expect(niceScale(200)).toEqual({ top: 240, step: 60 })
    for (const max of [1, 59, 61, 333, 1000, 5000]) {
      const { top, step } = niceScale(max)
      expect(top).toBeGreaterThanOrEqual(max)
      expect(top / step).toBeLessThanOrEqual(4)
      expect(Number.isInteger(top / step)).toBe(true)
    }
  })
})

describe('toCsv', () => {
  it('writes a header and one row per session, oldest first, with local date and 24h time', () => {
    const csv = toCsv([e(at(10, 11, 14, 5), 50, 'Second'), e(at(10, 10, 9, 30), 25, 'First')])
    expect(csv).toBe('date,time,task,minutes\r\n2026-11-10,09:30,First,25\r\n2026-11-11,14:05,Second,50\r\n')
  })

  it('quotes commas, quotes and newlines, and defuses spreadsheet formulas', () => {
    const rows = toCsv([
      e(at(10, 11, 9), 25, 'Write "intro", then edit'),
      e(at(10, 11, 10), 25, 'line1\nline2'),
      e(at(10, 11, 11), 25, '=HYPERLINK("x")'),
      e(at(10, 11, 12), 25, ''),
    ]).split('\r\n')
    expect(rows[1]).toBe('2026-11-11,09:00,"Write ""intro"", then edit",25')
    expect(rows[2]).toBe('2026-11-11,10:00,"line1\nline2",25')
    expect(rows[3]).toBe(`2026-11-11,11:00,"'=HYPERLINK(""x"")",25`)
    expect(rows[4]).toBe('2026-11-11,12:00,,25')
  })

  it('exports just the header when there is no history', () => {
    expect(toCsv([])).toBe('date,time,task,minutes\r\n')
  })
})

describe('formatMinutes', () => {
  it('formats minutes and hours', () => {
    expect(formatMinutes(45)).toBe('45 min')
    expect(formatMinutes(60)).toBe('1 h')
    expect(formatMinutes(125)).toBe('2 h 5 min')
  })
})
